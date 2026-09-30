import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test('Neues Bühnenbild adds a second empty scene on an existing production', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Szenenfolge',
    venueName: 'Hauptsaal',
    sceneName: 'Akt 1',
  });
  await expect(page.getByRole('heading', { name: 'Akt 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Zur Übersicht', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Bühnenbilder' })).toBeVisible();
  const production = page.getByRole('region', { name: 'Produktion Szenenfolge' });
  await expect(production.getByRole('button', { name: /Szenenfolge · Akt 1/ })).toBeVisible();
  await production.getByRole('button', { name: 'Neues Bühnenbild', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bühnenbild' }).fill('Akt 2');
  await page.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(production.getByRole('button', { name: /Szenenfolge · Akt 1/ })).toBeVisible();
  await expect(production.getByRole('button', { name: /Szenenfolge · Akt 2/ })).toBeVisible();
  await production.getByRole('button', { name: /Szenenfolge · Akt 2/ }).click();
  await expect(page.getByRole('heading', { name: 'Akt 2' })).toBeVisible();
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(0);
});


test('production gallery filters multiple plays and scene searches on desktop and mobile', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Sommerstück', venueName: 'Garten', sceneName: 'Abend' });
  await page.getByRole('button', { name: 'Zur Übersicht', exact: true }).click();
  await createProduction(page, { productionName: 'Winterstück', venueName: 'Saal', sceneName: 'Schnee' });
  await page.getByRole('button', { name: 'Zur Übersicht', exact: true }).click();
  await page.locator('.production-gallery').getByRole('button', { name: /Sommerstück/ }).click();
  await expect(page.getByRole('region', { name: 'Produktion Sommerstück' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Produktion Winterstück' })).toHaveCount(0);
  await page.getByRole('button', { name: /Alle Produktionen/ }).click();
  await page.getByLabel('Produktionen & Bühnenbilder suchen').fill('Schnee');
  await expect(page.getByRole('region', { name: 'Produktion Winterstück' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Produktion Sommerstück' })).toHaveCount(0);
  await page.getByLabel('Produktionen & Bühnenbilder suchen').fill('');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/productions-polish-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/productions-polish-mobile.png', fullPage: true });
});
