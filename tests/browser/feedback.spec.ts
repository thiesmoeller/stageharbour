import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { placeWallAt } from '../helpers/inspector.js';
import { pngBytes } from '../helpers/references.js';
import type { FeedbackReport } from '../../src/shared/feedback.js';

const entry = (page: import('@playwright/test').Page) => page.locator('.masthead').getByRole('button', { name: 'Feedback', exact: true });

test('feature feedback retains drafts and attachments on failure and clears on successful retry', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  await entry(page).click();
  const dialog = page.getByRole('dialog', { name: 'Feedback', exact: true });
  await expect(dialog.getByLabel('Worum geht es?')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Schließen', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Worum geht es?')).toBeFocused();
  await dialog.getByLabel('Worum geht es?').selectOption('feature');
  await dialog.getByLabel('Was möchten Sie einfacher erledigen können?').fill('Bühnenbilder nebeneinander vergleichen.');
  await expect(dialog.getByLabel(/Letzte Aktivitäten mitsenden/)).not.toBeChecked();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'report.png', mimeType: 'image/png', buffer: pngBytes(16, 16) });
  await expect(dialog.getByAltText('Bildvorschau 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await entry(page).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Bühnenbilder nebeneinander vergleichen.');
  await dialog.screenshot({ path: 'test-results/feedback-dialog.png' });
  let attempts = 0;
  let report: FeedbackReport | undefined;
  await page.route('**/feedback', async route => {
    report = route.request().postDataJSON(); attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, json: { message: 'Versand fehlgeschlagen, erneut versuchen.' } });
    else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Feedback senden' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Versand fehlgeschlagen');
  await expect(dialog.getByRole('textbox')).toHaveValue('Bühnenbilder nebeneinander vergleichen.');
  await expect(dialog.getByAltText('Bildvorschau 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Feedback senden' }).click();
  await expect(dialog.getByRole('status')).toContainText('E-Mail-Dienst');
  expect(report?.category).toBe('feature'); expect(report?.activity).toBeUndefined(); expect(report?.images).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await entry(page).click(); await expect(dialog.getByRole('textbox')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('issue captures an unsaved layout, freezes context and excludes removed attachments', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Feedback Entwurf', venueName: 'Feedback Bühne', sceneName: 'Ungespeichert' });
  await page.route('**/scenes/*/layout', route => route.fulfill({ status: 503, json: { message: 'Speichern fehlgeschlagen' } }));
  // Match the actual save endpoint without intercepting unrelated scene reads.
  await page.route('**/scenes/*', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, json: { message: 'Speichern fehlgeschlagen' } }) : route.continue());
  await placeWallAt(page, 3000, 3000);
  await expect(page.locator('.save-status')).toContainText('Speichern fehlgeschlagen');
  await page.locator('#wall-x').fill('3333'); // Leave this buffered input unapplied.
  await entry(page).click();
  const dialog = page.getByRole('dialog', { name: 'Feedback', exact: true });
  await expect(dialog.getByAltText('Bildvorschau 1')).toBeVisible();
  await expect(dialog.getByLabel(/Aktuellen Entwurf anhängen/)).not.toBeChecked();
  await dialog.getByLabel(/Aktuellen Entwurf anhängen/).check();
  await dialog.getByLabel(/Was ist passiert/).fill('Die Wand wird nicht gespeichert.');
  await dialog.getByText('Wird mitgesendet', { exact: true }).click();
  await expect(dialog.locator('pre').first()).toContainText('"unappliedInputs": true');
  await expect(dialog.locator('pre').first()).toContainText('"dirty": true');
  await dialog.getByRole('button', { name: 'Bild 1 entfernen' }).click();
  await dialog.getByLabel('Arbeitsdetails mitsenden').uncheck();
  let sent: FeedbackReport | undefined;
  await page.route('**/feedback', async route => { sent = route.request().postDataJSON(); await route.continue(); });
  await dialog.getByRole('button', { name: 'Feedback senden' }).click();
  await expect(dialog.getByRole('status')).toContainText('E-Mail-Dienst');
  expect(sent?.images).toHaveLength(0); expect(sent?.work).toBeUndefined();
  const snapshot = JSON.parse(sent!.snapshot!);
  expect(snapshot.layout.walls).toHaveLength(1); expect(snapshot.layout.walls[0].x).not.toBe(3333);
  expect(sent?.activity?.some(event => event.action === 'editor.change')).toBe(true);
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.locator('#wall-x')).toHaveValue('3333');
});

test('feedback works in fullscreen with 3D capture and on mobile with keyboard dismissal', async ({ page }) => {
  test.setTimeout(60_000);
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Feedback Vollbild', venueName: 'Vollbild Bühne' });
  await page.getByRole('button', { name: 'Raumansicht', exact: true }).click();
  await expect(page.locator('[data-renderer="pascal"] canvas')).toBeVisible({ timeout: 30_000 });
  await page.locator('.editor').evaluate(element => element.requestFullscreen());
  await page.locator('.editor-menubar summary').filter({ hasText: /^Hilfe$/ }).click();
  await page.locator('.editor-menubar').getByRole('button', { name: 'Feedback', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Feedback', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByAltText('Bildvorschau 1')).toBeVisible({ timeout: 25_000 });
  await page.evaluate(() => document.fullscreenElement ? document.exitFullscreen() : undefined);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Worum geht es?')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await entry(page).click();
  await expect(dialog).toBeInViewport();
  await dialog.getByRole('textbox').fill('Mobile Rückmeldung');
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await expect(entry(page)).toBeFocused();
});

test('feedback remains available without an editor screenshot and sign-out clears the draft', async ({ page }) => {
  await signInToPlans(page);
  await page.goto('/#/hilfe');
  await entry(page).click();
  const dialog = page.getByRole('dialog', { name: 'Feedback', exact: true });
  await expect(dialog.getByLabel('Bild hinzufügen oder hier einfügen (PNG/JPEG, je 2 MiB, höchstens 2)')).toBeVisible();
  await expect(dialog.locator('.feedback-images figure')).toHaveCount(0);
  await dialog.getByRole('textbox').fill('Bericht ohne Bild');
  await expect(dialog.getByRole('button', { name: 'Feedback senden' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await signInToPlans(page);
  await entry(page).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('');
});

test('feedback entry remains hidden when mail is unconfigured', async ({ page }) => {
  await page.route('**/api/feedback-options', route => route.fulfill({ json: { enabled: false, version: 'test' } }));
  await signInToPlans(page);
  await expect(entry(page)).toHaveCount(0);
});

test('venue feedback captures the draft and both visible panes without publishing it', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInToPlans(page);
  await page.getByRole('button', { name: /Spielstätten & Bühnen/ }).click();
  await page.getByRole('button', { name: 'Neue Spielstätte', exact: true }).click();
  await page.getByLabel('Name der Spielstätte').fill('Feedback Spielstätte');
  await page.getByRole('button', { name: 'Spielstätte anlegen', exact: true }).click();
  await page.getByRole('button', { name: '2D + 3D', exact: true }).click();
  await expect(page.locator('[data-renderer="pascal"] canvas')).toBeVisible({ timeout: 30_000 });
  // Existing editing controls must remain available when feedback capture is registered.
  await expect(page.getByRole('button', { name: 'Einfache Darstellung', exact: true })).toBeVisible();
  await entry(page).click();
  const dialog = page.getByRole('dialog', { name: 'Feedback', exact: true });
  await expect(dialog.getByAltText('Bildvorschau 1')).toBeVisible({ timeout: 25_000 });
  await dialog.getByLabel(/Aktuellen Entwurf anhängen/).check();
  await dialog.getByRole('textbox').fill('Die Spielstätte soll einfacher bearbeitbar sein.');
  let sent: FeedbackReport | undefined;
  await page.route('**/feedback', async route => { sent = route.request().postDataJSON(); await route.continue(); });
  await dialog.getByRole('button', { name: 'Feedback senden' }).click();
  await expect(dialog.getByRole('status')).toContainText('E-Mail-Dienst');
  expect(sent?.page.section).toBe('venues'); expect(sent?.work?.view).toBe('split');
  expect(sent?.images).toHaveLength(1); expect(JSON.parse(sent!.snapshot!).kind).toBe('venue');
});
