import { showProperties } from '../helpers/inspector.js';
import { test, expect } from '@playwright/test';
import { signInToPlans, createProduction } from '../helpers/plans.js';

test('delete confirmations use the app modal instead of the browser dialog', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', dialog => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'ConfirmModal',
    venueName: 'ConfirmSaal',
    sceneName: 'ConfirmSzene',
  });
  await expect(page.getByRole('heading', { name: 'ConfirmSzene' })).toBeVisible();
  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Bühnenbilder' })).toBeVisible();

  const card = page.locator('.scene-card').filter({
    has: page.getByRole('button', { name: 'ConfirmModal · ConfirmSzene ConfirmSaal' }),
  });
  await card.getByText('Weitere Aktionen').click();
  await card.getByRole('button', { name: 'Löschen', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Bühnenbild löschen?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('ConfirmModal · ConfirmSzene');
  await expect(dialog.getByRole('button', { name: 'Bühnenbild löschen' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ConfirmModal · ConfirmSzene ConfirmSaal' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

test('pending deletion can be cancelled and modal shortcuts cannot edit the scene', async ({ page }) => {
  const { placeWallAt, planWalls } = await import('../helpers/inspector.js');
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Protected commands', venueName: 'Protected hall', sceneName: 'Protected scene' });
  await placeWallAt(page);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await page.getByLabel('X (mm)', { exact: true }).fill('4500');
  await page.getByRole('button', { name: 'Wand löschen', exact: true }).click();
  await page.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(planWalls(page)).toHaveCount(1);
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('4500');
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await page.getByRole('button', { name: 'Wandtypen wählen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Wandtypen', exact: true })).toBeVisible();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await expect(planWalls(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('confirmed dirty route leave is not vetoed by the scene editor', async ({ page }) => {
  const { placeWallAt } = await import('../helpers/inspector.js');
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Route leave',
    venueName: 'Route hall',
    sceneName: 'Route scene',
  });
  await placeWallAt(page);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await page.getByLabel('X (mm)', { exact: true }).fill('4500');
  await expect(page.locator('.save-status')).toHaveText('Nicht übernommene Eingaben');
  await page.evaluate(() => { window.location.hash = '#/produktionen'; });
  const dialog = page.getByRole('dialog', { name: 'Ort wechseln?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Verwerfen und wechseln', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Bühnenbilder' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/produktionen$/);
});

test('venue name edits are pending and protected on leave', async ({ page }) => {
  await signInToPlans(page);
  await page.getByRole('button', { name: /Spielstätten & Bühnen/ }).click();
  await page.getByRole('button', { name: 'Neue Spielstätte', exact: true }).click();
  await page.getByLabel('Name der Spielstätte').fill('Namensaal');
  await page.getByRole('button', { name: 'Spielstätte anlegen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Namensaal', exact: true })).toBeVisible();
  await showProperties(page);
  await page.locator('.inspector-section').filter({ has: page.locator('summary', { hasText: 'Umriss' }) })
    .evaluate(element => { (element as HTMLDetailsElement).open = true; });
  await page.getByLabel('Name der Spielstätte').fill('Namensaal geändert');
  await expect(page.getByText('Nicht gespeicherter Spielstättenname', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zur Spielstättenübersicht' })).toBeDisabled();
  await page.evaluate(() => { window.location.hash = '#/produktionen'; });
  const dialog = page.getByRole('dialog', { name: 'Ort wechseln?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  await expect(page.getByLabel('Name der Spielstätte')).toHaveValue('Namensaal geändert');
  await page.evaluate(() => { window.location.hash = '#/produktionen'; });
  await page.getByRole('dialog', { name: 'Ort wechseln?' })
    .getByRole('button', { name: 'Verwerfen und wechseln', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Bühnenbilder' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('venue stage-deck sizes buffer typing before snap', async ({ page }) => {
  await signInToPlans(page);
  await page.getByRole('button', { name: /Spielstätten & Bühnen/ }).click();
  await page.getByRole('button', { name: 'Neue Spielstätte', exact: true }).click();
  await page.getByLabel('Name der Spielstätte').fill('DeckSaal');
  await page.getByRole('button', { name: 'Spielstätte anlegen', exact: true }).click();
  const svg = page.locator('svg[aria-label="Umriss der Spielstätte"]');
  await page.getByRole('button', { name: 'Podest setzen' }).click();
  const spot = await svg.evaluate((element) => {
    const mapped = new DOMPoint(4000, -3000).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: mapped.x, y: mapped.y };
  });
  await page.mouse.click(spot.x, spot.y);
  await expect(page.locator('[data-testid^="venue-platform-"]')).toHaveCount(1);
  await showProperties(page);
  await page.getByLabel('Podest Bauweise').selectOption({ label: 'Bühnenelement' });
  const width = page.getByLabel('Podest Breite');
  await width.click();
  await width.fill('');
  await page.keyboard.type('2');
  await expect(width).toHaveValue('2');
  await page.keyboard.type('000');
  await expect(width).toHaveValue('2000');
  await width.press('Enter');
  await expect(width).toHaveValue('2000');
  await expect(page.getByText('Nicht übernommene Eingaben', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Unveröffentlichter Spielstättenentwurf', { exact: true })).toBeVisible();
});
