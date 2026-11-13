import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { placeNamedObjectAt, placeWallAt } from '../helpers/inspector.js';

test('stock pieces are assigned in the inspector and the venue visit reports stock demand', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await signInToPlans(page);
  const label = `BD-${Date.now().toString(36)}`;
  const navigation = page.getByRole('navigation', { name: 'Arbeitsbereiche' });

  await navigation.getByRole('button', { name: /Bestand/ }).click();
  await page.getByLabel('Etikett').fill(label);
  await page.getByLabel('Bauteil').selectOption({ label: 'Wandelement' });
  await page.getByLabel('Variante').selectOption('plain');
  await page.getByRole('button', { name: 'Bestandsstück anlegen' }).click();
  await expect(page.getByRole('row').filter({ hasText: label })).toBeVisible();
  await page.getByTestId('bestand-tab-counts').click();
  const slabs = page.getByLabel('Stückzahl Betonplatte 400 × 400 × 50 mm', { exact: true });
  await slabs.fill('1');
  const savedCount = page.waitForResponse(response => response.url().endsWith('/stock/counts') && response.request().method() === 'PUT');
  await page.getByRole('row').filter({ has: slabs }).getByRole('button', { name: 'Speichern' }).click();
  expect((await savedCount).ok()).toBe(true);
  await expect(slabs).toHaveValue('1');

  await navigation.getByRole('button', { name: /Produktionen/ }).click();
  await createProduction(page, { productionName: 'Bestandsprobe', venueName: 'Bestandssaal', sceneName: 'Bedarf' });
  await placeWallAt(page, 2500, 3000);
  const stock = page.getByLabel('Bestandsstück', { exact: true });
  await stock.selectOption({ label });
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await expect(stock).toHaveValue(/.+/);

  await placeWallAt(page, 4500, 3000);
  const taken = page.getByLabel('Bestandsstück', { exact: true }).locator('option', { hasText: label });
  await expect(taken).toHaveText(/schon zugeordnet/);
  await expect(taken).toBeDisabled();

  await placeNamedObjectAt(page, 'Stütze hinzufügen', 2500, 3600);
  await page.getByLabel('Betonplatten', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');

  await page.getByRole('button', { name: 'Zur Übersicht', exact: true }).click();
  const production = page.getByRole('region', { name: 'Produktion Bestandsprobe' });
  await production.getByText('Materialbedarf', { exact: true }).click();
  const demand = production.locator('[data-testid^="stock-demand-"]');
  await expect(demand).toBeVisible();
  const walls = demand.getByRole('row').filter({ hasText: 'Wandelement' });
  await expect(walls.getByRole('cell').nth(2)).toHaveText('2');
  await expect(walls.getByRole('cell').nth(3)).toHaveText('1');
  const ballast = demand.getByRole('row').filter({ hasText: 'Betonplatte' });
  await expect(ballast.getByRole('cell')).toHaveText(['Betonplatte 400 × 400 × 50 mm', '—', '2', '—', '1', '1']);
  await expect(ballast).toHaveClass(/shortage/);
  expect(errors).toEqual([]);
});
