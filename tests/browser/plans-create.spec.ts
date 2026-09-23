import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test('Neue Szene adds a second empty scene on an existing production', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Szenenfolge',
    venueName: 'Hauptsaal',
    sceneName: 'Akt 1',
  });
  await expect(page.getByRole('heading', { name: 'Akt 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Zur Übersicht', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  const production = page.getByRole('region', { name: 'Produktion Szenenfolge' });
  await expect(production.getByRole('button', { name: /Szenenfolge · Akt 1/ })).toBeVisible();
  await production.getByRole('button', { name: 'Neue Szene', exact: true }).click();
  await page.getByRole('textbox', { name: 'Szene' }).fill('Akt 2');
  await page.getByRole('button', { name: 'Szene anlegen' }).click();
  await expect(production.getByRole('button', { name: /Szenenfolge · Akt 1/ })).toBeVisible();
  await expect(production.getByRole('button', { name: /Szenenfolge · Akt 2/ })).toBeVisible();
  await production.getByRole('button', { name: /Szenenfolge · Akt 2/ }).click();
  await expect(page.getByRole('heading', { name: 'Akt 2' })).toBeVisible();
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(0);
});
