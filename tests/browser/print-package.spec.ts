import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { revealEditorCommand } from '../helpers/editorMenus.js';

async function openDocuments(page: import('@playwright/test').Page) {
  await revealEditorCommand(page, 'PDF gestalten');
  await page.getByRole('button', { name: 'PDF gestalten' }).click();
  return page.getByRole('dialog', { name: 'Dokument erstellen' });
}

test('the studio opens with pages, saves a draft, proves and downloads the exact reviewed document', async ({ page }) => {
  test.setTimeout(60_000);
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Dokumentfluss', venueName: 'Probensaal', sceneName: 'Probe' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  const workspace = await openDocuments(page);
  await expect(workspace.getByTestId('document-sheet')).toBeVisible();
  await expect(workspace.getByRole('button', { name: /^Aufbau \/ Technik/ })).toHaveAttribute('aria-pressed', 'true');
  await workspace.getByRole('button', { name: /Hinweise anzeigen/ }).click();
  await expect(workspace.getByRole('region', { name: 'Dokumenthinweise' })).toContainText('Noch keine tatsächlichen Kabelwege geplant');
  await workspace.getByRole('button', { name: 'Hinweise schließen' }).click();
  await workspace.getByLabel('Bezeichnung der Fassung').fill('Aufbaufassung');
  await workspace.getByText('Einleitung und Kontakt', { exact: true }).click();
  await workspace.getByLabel('Einleitung', { exact: true }).fill('Aufbau am Vortag.');
  await workspace.getByRole('button', { name: 'Entwurf speichern', exact: true }).click();
  await expect(workspace.locator('.studio-save-state')).toHaveText('Gespeichert');
  await workspace.getByRole('button', { name: 'PDF exportieren', exact: true }).click();
  await expect(workspace.getByTitle('PDF-Vorschau')).toBeVisible({ timeout: 30_000 });
  await expect(workspace).toContainText(/Blatt bereit/);
  const before = await workspace.getByTitle('PDF-Vorschau').getAttribute('src');
  await workspace.getByLabel('Bezeichnung der Fassung').fill('Aufbaufassung geprüft');
  await expect(workspace).toContainText('Diese Vorschau ist veraltet');
  expect(await workspace.getByTitle('PDF-Vorschau').getAttribute('src')).toBe(before);
  await workspace.getByRole('button', { name: 'Vorschau aktualisieren', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'PDF herunterladen', exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.route('**/documents/*/issue', route => route.fulfill({ status: 409, json: { message: 'Die Vorschau ist abgelaufen. Bitte erneut vorbereiten.' } }), { times: 1 });
  await workspace.getByRole('button', { name: 'PDF herunterladen', exact: true }).click();
  await expect(workspace.getByRole('alert')).toContainText('Die Vorschau ist abgelaufen');
  await expect(workspace).toContainText('Diese Vorschau ist veraltet');
  await workspace.getByRole('button', { name: 'Vorschau aktualisieren', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'PDF herunterladen', exact: true })).toBeEnabled({ timeout: 30_000 });
  const file = page.waitForEvent('download');
  await workspace.getByRole('button', { name: 'PDF herunterladen', exact: true }).click();
  expect((await file).suggestedFilename()).toContain('Aufbaufassung_geprüft');
  await expect(workspace).toContainText('Diese Fassung wurde herausgegeben.');
  await workspace.getByRole('button', { name: 'Zurück zum Editor' }).click();
  const reopened = await openDocuments(page);
  await expect(reopened.getByLabel('Bezeichnung der Fassung')).toHaveValue('Aufbaufassung geprüft');
  await reopened.getByText('Einleitung und Kontakt', { exact: true }).click();
  await expect(reopened.getByLabel('Einleitung', { exact: true })).toHaveValue('Aufbau am Vortag.');
});

test('an actual tech-stand cable run is editable and clears the technical readiness warning', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Kabelprobe', venueName: 'Kabelsaal', sceneName: 'Aufbau' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Kabel zeichnen' }).click();
  const plan = page.getByRole('img', { name: 'Grundriss der Spielstätte' });
  const box = await plan.boundingBox();
  if (!box) throw new Error('Plan not visible');
  await plan.click({ position: { x: box.width * 0.18, y: box.height * 0.7 } });
  await plan.click({ position: { x: box.width * 0.28, y: box.height * 0.55 } });
  await plan.click({ position: { x: box.width * 0.42, y: box.height * 0.35 } });
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Tatsächliche Kabelwege' });
  await expect(panel).toContainText('3 Punkte');
  await expect(panel).toContainText('benötigt');
  await expect(page.getByTestId('selection-count')).toHaveText('1 Kabelweg ausgewählt');
  const run = page.locator('[data-testid^="cable-run-"]').first();
  const runId = (await run.getAttribute('data-testid'))!.replace('cable-run-', '');
  await expect(run).toHaveAttribute('aria-selected', 'true');
  const mid = page.getByTestId(`cable-run-vertex-${runId}-1`);
  await expect(mid).toBeVisible();
  await mid.click();
  await expect(page.getByTestId('selection-count')).toHaveText('1 Zwischenpunkt ausgewählt');
  await plan.focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId(`cable-run-${runId}`)).toBeVisible();
  // Midpoint gone: former end is now index 1; only endpoints remain.
  await expect(page.getByTestId(`cable-run-vertex-${runId}-2`)).toHaveCount(0);
  await expect(panel).toContainText('2 Punkte');
  await expect(page.getByTestId('selection-count')).toHaveText('1 Kabelweg ausgewählt');
  // Second click on the selected path (between endpoints) inserts a midpoint.
  const endA = await page.getByTestId(`cable-run-vertex-${runId}-0`).boundingBox();
  const endB = await page.getByTestId(`cable-run-vertex-${runId}-1`).boundingBox();
  if (!endA || !endB) throw new Error('Cable endpoints not visible');
  await page.mouse.click(
    (endA.x + endA.width / 2 + endB.x + endB.width / 2) / 2,
    (endA.y + endA.height / 2 + endB.y + endB.height / 2) / 2,
  );
  await expect(panel).toContainText('3 Punkte');
  await expect(page.getByTestId('selection-count')).toHaveText('1 Zwischenpunkt ausgewählt');
  await plan.focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('selection-count')).toHaveText('1 Kabelweg ausgewählt');
  await expect(panel).toContainText('2 Punkte');
  await plan.focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-testid^="cable-run-"]')).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  // Redraw for the document readiness check below.
  await page.getByRole('button', { name: 'Kabel zeichnen' }).click();
  await plan.click({ position: { x: box.width * 0.18, y: box.height * 0.7 } });
  await plan.click({ position: { x: box.width * 0.42, y: box.height * 0.35 } });
  await page.keyboard.press('Enter');
  await panel.getByLabel('Kabeltyp').fill('Schuko 16 A');
  await panel.getByLabel('Anzahl').fill('3');
  await panel.getByLabel('Von').fill('Technikstand FOH');
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await panel.getByRole('button', { name: 'Schließen' }).click();
  const workspace = await openDocuments(page);
  await expect(workspace).not.toContainText('Noch keine tatsächlichen Kabelwege geplant');
  await workspace.getByRole('button', { name: 'Druckvorschau', exact: true }).click();
  await expect(workspace.getByTitle('PDF-Vorschau')).toBeVisible({ timeout: 30_000 });
});

test('performer preset builds a reduced handout in the same workspace', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Orientierung', venueName: 'Saal', sceneName: 'Szene' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  const workspace = await openDocuments(page);
  await workspace.getByRole('button', { name: /Darstellende/ }).click();
  await workspace.getByRole('button', { name: 'Inhalt', exact: true }).click();
  await expect(workspace.getByRole('checkbox', { name: 'Orientierungsplan' })).toBeChecked();
  await expect(workspace.getByRole('checkbox', { name: 'Bemaßter Grundriss' })).not.toBeChecked();
  await expect(workspace.getByRole('checkbox', { name: 'Kabelliste' })).not.toBeChecked();
  await expect(workspace.getByTestId('document-sheet')).toBeVisible();
});

test('panels scroll independently and mobile users can reach the sheet, pages and numeric controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Studio auf kleinen Bildschirmen', venueName: 'Saal', sceneName: 'Szene' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  const workspace = await openDocuments(page);
  await expect(workspace.getByTestId('document-sheet')).toBeVisible();
  const geometry = await workspace.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, width: rect.width, viewportWidth: innerWidth };
  });
  expect(geometry.top).toBe(0); expect(geometry.bottom).toBe(geometry.viewport); expect(geometry.width).toBe(geometry.viewportWidth);
  const panel = workspace.locator('.studio-inspector .studio-panel-scroll');
  await expect.poll(() => panel.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  await expect(workspace.getByRole('button', { name: 'PDF exportieren', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/document-studio-laptop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const navigation = workspace.getByRole('navigation', { name: 'Studiobereich' });
  await navigation.getByRole('button', { name: 'Eigenschaften' }).click();
  await expect(workspace.getByLabel('Bezeichnung der Fassung')).toBeVisible();
  await navigation.getByRole('button', { name: 'Seiten' }).click();
  await expect(workspace.getByRole('button', { name: /^Seite 1:/ })).toBeVisible();
  await navigation.getByRole('button', { name: 'Blatt', exact: true }).click();
  await expect(workspace.getByTestId('document-sheet')).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'PDF exportieren', exact: true })).toBeInViewport();
  expect(await workspace.evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/document-studio-mobile.png' });
});
