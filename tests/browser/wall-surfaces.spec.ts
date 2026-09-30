import { placeWallAt, planWalls } from '../helpers/inspector.js';
import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test('wall surface editor uniform library finish covers all faces', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Wandoberflächen Einfach',
    venueName: 'Probebühne',
    sceneName: 'Einheitlich',
  });
  await page.getByRole('button', { name: '2D + 3D', exact: true }).click();
  await placeWallAt(page);
  const surfaces = page.getByTestId('surface-editor');
  await expect(surfaces).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Oberflächen-Zuweisung')).toHaveValue('uniform');
  await page.getByLabel('surface-uniform Art').selectOption('library');
  await page.getByLabel('surface-uniform Bibliothek').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
  await expect(page.getByLabel('surface-uniform Art')).toHaveValue('library');
  await expect(page.getByTestId('stage-view').locator('.model-error')).toHaveCount(0);
});

test('wall surface editor assigns wood lower and paint upper bands', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Wandoberflächen',
    venueName: 'Probebühne',
    sceneName: 'Streifen',
  });
  await page.getByRole('button', { name: '2D + 3D', exact: true }).click();
  await placeWallAt(page);
  await page.locator('#wall-height').fill('2400');
  const surfaces = page.getByTestId('surface-editor');
  await expect(surfaces).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Oberflächen-Zuweisung').selectOption('perFace');
  await surfaces.locator('summary').filter({ hasText: 'Vorderseite' }).click();
  await page.getByLabel('Vorderseite Aufteilung').selectOption('bands');
  await expect(page.getByLabel('Vorderseite Teilungshöhe')).toHaveValue('1200');
  await page.getByLabel('surface-front-lower Art').selectOption('library');
  await page.getByLabel('surface-front-lower Bibliothek').selectOption({ index: 1 });
  await page.getByLabel('surface-front-lower Faserrichtung').selectOption('90');
  await page.getByLabel('surface-front-upper Art').selectOption('paint');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
  await expect(planWalls(page)).toHaveCount(1);
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveCount(1);
  await expect(page.getByLabel('Oberflächen-Zuweisung')).toHaveValue('perFace');
  await expect(page.getByLabel('Vorderseite Aufteilung')).toHaveValue('bands');
  await expect(page.getByLabel('surface-front-lower Art')).toHaveValue('library');
  await expect(page.getByLabel('surface-front-upper Art')).toHaveValue('paint');
  await expect(page.getByLabel('surface-front-lower Faserrichtung')).toHaveValue('90');
  await expect(page.getByTestId('stage-view').locator('.model-error')).toHaveCount(0);
});
