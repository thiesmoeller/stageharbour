import { test, expect } from '@playwright/test';
import { signInToPlans } from '../helpers/plans.js';

test('Bestand manages catalog parts and physical stock items', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);

  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Bestand/ }).click();
  await expect(page).toHaveURL(/#\/bestand/);
  await expect(page.getByTestId('bestand-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bestand', exact: true })).toBeVisible();
  await expect(page.getByTestId('bestand-tab-items')).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Etikett').fill('Bestand-W01');
  await page.getByLabel('Bauteil').selectOption({ label: 'Wandelement' });
  await page.getByLabel('Variante').selectOption('plain');
  const created = page.waitForResponse(response => response.url().endsWith('/stock/items') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Bestandsstück anlegen' }).click();
  expect((await created).ok()).toBeTruthy();
  const row = page.getByRole('row').filter({ hasText: 'Bestand-W01' });
  await expect(row.getByRole('cell')).toHaveText(['Bestand-W01', 'Wandelement', 'Glattwand', /verwendbar/]);
  await row.getByRole('checkbox').uncheck();
  await expect(row.getByRole('checkbox')).not.toBeChecked();

  await page.getByTestId('bestand-tab-parts').click();
  await expect(page.getByTestId('bestand-parts')).toContainText('Wandelement');
  await expect(page.getByTestId('bestand-parts')).toContainText('Bühnenelement');
  await expect(page.getByTestId('bestand-parts')).toContainText('Stützdreieck');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/stock-polish-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/stock-polish-desktop.png', fullPage: true });
  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Produktionen/ }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Bühnenbilder' })).toBeVisible();
  expect(errors).toEqual([]);
});
