import { test, expect } from '@playwright/test';
import { testAdministrator } from '../helpers/database.js';
import { createProduction } from '../helpers/plans.js';

// Bound a stuck interaction separately from this journey's total render time.
test.use({ actionTimeout: 30_000 });

test('design a venue independently, reuse it in a production, and save scene lighting separately', async ({ page }) => {
  // Preserve 90s locally, but scale the CI software-rendering budget as well.
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await test.step('Create and publish a venue with warm lighting', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.getByLabel('E-Mail-Adresse').fill(testAdministrator.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testAdministrator.password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByRole('button', { name: /Spielstätten & Bühnen/ }).click();
    await page.getByRole('button', { name: 'Neue Spielstätte', exact: true }).click();
    await page.getByLabel('Name der Spielstätte').fill('Studiobühne');
    await page.getByRole('button', { name: 'Spielstätte anlegen', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Studiobühne', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wand hinzufügen', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Feste Wand setzen' }).click();
    const svg = page.locator('svg[aria-label="Umriss der Spielstätte"]');
    await svg.scrollIntoViewIfNeeded();
    async function clickPlan(x: number, y: number) {
      const screen = await svg.evaluate((element, p) => {
        const ctm = (element as SVGSVGElement).getScreenCTM();
        if (!ctm) return { x: 0, y: 0 };
        return new DOMPoint(p.x, -p.y).matrixTransform(ctm);
      }, { x, y });
      await page.mouse.click(screen.x, screen.y);
    }
    await clickPlan(1000, 3000);
    await clickPlan(7000, 3000);
    await page.getByLabel('Feste Wand 1 width').fill('6000');
    await page.getByLabel('Feste Wand 1 y').fill('4500');
    await page.locator('.lighting-panel summary').click();
    await page.locator('.lighting-presets').getByRole('button', { name: 'Warm', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Zur Spielstättenübersicht' })).toBeDisabled();
    await page.getByRole('button', { name: 'Spielstätte speichern', exact: true }).click();
    await expect(page.getByText('Spielstättenfassung gespeichert', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Zur Spielstättenübersicht' }).click();
    await expect(page.getByRole('button', { name: /Studiobühne.*gestalten/ })).toBeVisible();
    await page.screenshot({ path: 'test-results/venue-library.png', fullPage: true });
  });
  await test.step('Reuse the published venue in a production', async () => {
    await page.getByRole('button', { name: /Produktionen & Szenen/ }).click();
    await expect(page.getByRole('button', { name: /Studiobühne/ })).toHaveCount(0);
    await createProduction(page, {
      productionName: 'Lichtprobe',
      existingVenue: 'Studiobühne',
    });
    await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveCount(1);
  });
  await test.step('Render scene lighting, undo and redo, and verify blackout', async () => {
    await page.getByRole('button', { name: 'Raumansicht', exact: true }).click();
    await page.locator('.lighting-panel summary').click();
    await expect(page.getByLabel('Bühnenlicht aktivieren')).toBeChecked();
    await expect(page.getByLabel('Frontlichtfarbe')).toHaveValue('#ffd19a');
    await page.locator('.lighting-presets').getByRole('button', { name: 'Kühl', exact: true }).click();
    await expect(page.getByLabel('Frontlichtfarbe')).toHaveValue('#c1d8ff');
    await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
    await expect(page.getByLabel('Frontlichtfarbe')).toHaveValue('#ffd19a');
    await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
    await expect(page.getByLabel('Frontlichtfarbe')).toHaveValue('#c1d8ff');
    await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
    const canvas = page.locator('[data-renderer="pascal"] canvas');
    await expect(canvas).toBeVisible();
    await page.locator('.lighting-panel summary').click();
    await page.waitForTimeout(1000);
    const lit = await canvas.screenshot({ path: 'test-results/stage-lighting-cool.png' });
    await page.locator('.lighting-panel summary').click();
    await page.getByLabel('Frontlicht (%)', { exact: true }).fill('0');
    await page.getByLabel('Gegenlicht (%)', { exact: true }).fill('0');
    await page.getByLabel('Grundhelligkeit (%)', { exact: true }).fill('0');
    await page.locator('.lighting-panel summary').click();
    await page.waitForTimeout(500);
    const dark = await canvas.screenshot({ path: 'test-results/stage-lighting-blackout.png' });
    expect(lit.equals(dark)).toBe(false);
    await page.locator('.lighting-panel summary').click();
    await page.locator('.lighting-presets').getByRole('button', { name: 'Kühl', exact: true }).click();
    await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
  });
  await test.step('Reload scene lighting without changing the venue preset', async () => {
    await page.reload();
    const editor = page.getByRole('heading', { name: 'Szene 1', exact: true });
    const card = page.getByRole('button', { name: /Lichtprobe · Szene 1/ });
    const workspace = page.getByRole('region', { name: 'Szene bearbeiten' });
    try {
      await workspace.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      await card.click();
    }
    await expect(editor).toBeVisible();
    await page.locator('.lighting-panel summary').click();
    await expect(page.getByLabel('Frontlichtfarbe')).toHaveValue('#c1d8ff');
    await page.getByRole('button', { name: 'Zur Übersicht' }).click();
    await page.getByRole('button', { name: /Spielstätten & Bühnen/ }).click();
    await page.getByRole('button', { name: /Studiobühne.*gestalten/ }).click();
    await page.locator('.lighting-panel summary').click();
    await expect(page.getByLabel('Frontlichtfarbe')).toHaveValue('#ffd19a');
  });
  await test.step('Publish a venue update and copy the scene to another venue', async () => {
    await page.getByLabel('Spielstättenobjekt auswählen').selectOption({ label: 'Feste Wand 1' });
    await expect(page.getByLabel('Feste Wand 1 width')).toHaveValue('6000');
    await page.locator('.inspector-section').filter({ has: page.locator('summary', { hasText: 'Überbauung' }) }).locator('summary').click();
    await page.getByLabel('Deckenhöhe über Fußboden (mm)').fill('5500');
    await page.getByRole('button', { name: 'Spielstätte speichern', exact: true }).click();
    await expect(page.getByText('Spielstättenfassung gespeichert', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Zur Spielstättenübersicht' }).click();
    await page.getByRole('button', { name: /Produktionen & Szenen/ }).click();
    await expect(page.getByRole('button', { name: /Lichtprobe · Szene 1/ })).toContainText('Aktualisierung verfügbar');
    await page.getByRole('button', { name: /Spielstätten & Bühnen/ }).click();
    await page.getByRole('button', { name: 'Neue Spielstätte', exact: true }).click();
    await page.getByLabel('Name der Spielstätte').fill('Gastbühne');
    await page.getByRole('button', { name: 'Spielstätte anlegen', exact: true }).click();
    await page.getByRole('button', { name: 'Zur Spielstättenübersicht' }).click();
    await page.getByRole('button', { name: /Produktionen & Szenen/ }).click();
    const lightingCard = page.locator('.scene-card').filter({ has: page.getByRole('button', { name: /Lichtprobe · Szene 1/ }) });
    await lightingCard.locator('summary', { hasText: 'Weitere Aktionen' }).click();
    await lightingCard.getByRole('button', { name: 'In andere Spielstätte kopieren' }).click();
    await page.getByLabel('Zielspielstätte').selectOption({ label: 'Gastbühne' });
    await page.getByRole('textbox', { name: 'Szene', exact: true }).fill('Gastszene');
    await page.getByRole('button', { name: 'Als Spielstättenanpassung anlegen' }).click();
    await page.getByRole('button', { name: /Lichtprobe · Gastszene/ }).click();
    await expect(page.locator('.scene-context').filter({ hasText: 'Lichtprobe · Gastbühne' })).toBeVisible();
    await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveCount(0);
  });
  expect(errors).toEqual([]);
});
