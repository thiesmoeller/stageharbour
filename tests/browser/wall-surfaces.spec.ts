import { expect, test } from '@playwright/test';
import { placeWallAt } from '../helpers/inspector.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test('part face finishes support library materials, paint and horizontal bands', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Bauteiloberflächen',
    venueName: 'Probebühne',
    sceneName: 'Streifen',
  });
  await placeWallAt(page);
  await page.getByText('Oberflächen', { exact: true }).click();

  await page.getByLabel('part-finish-front-full Art').selectOption('library');
  await page.getByLabel('part-finish-front-full Bibliothek').selectOption({ index: 1 });
  await page.getByLabel('part-finish-front-full Faserrichtung').selectOption('90');

  await page.getByLabel('Rückseite Aufteilung').selectOption('bands');
  await page.getByLabel('Teilungshöhe (mm)').fill('1200');
  await page.getByLabel('part-finish-back-lower Art').selectOption('library');
  await page.getByLabel('part-finish-back-upper Art').selectOption('paint');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');

  await page.reload();
  await page.locator('[data-testid^="object-"] polygon').click();
  await page.getByText('Oberflächen', { exact: true }).click();
  await expect(page.getByLabel('part-finish-front-full Art')).toHaveValue('library');
  await expect(page.getByLabel('part-finish-front-full Faserrichtung')).toHaveValue('90');
  await expect(page.getByLabel('Rückseite Aufteilung')).toHaveValue('bands');
  await expect(page.getByLabel('Teilungshöhe (mm)')).toHaveValue('1200');
  await expect(page.getByLabel('part-finish-back-lower Art')).toHaveValue('library');
  await expect(page.getByLabel('part-finish-back-upper Art')).toHaveValue('paint');
});
