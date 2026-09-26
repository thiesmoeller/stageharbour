import { test, expect } from '@playwright/test';
import { signInToPlans } from '../helpers/plans.js';

test('Bestand workspace manages panels and stocked wall types under lease', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);

  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Bestand/ }).click();
  await expect(page).toHaveURL(/#\/bestand/);
  await expect(page.getByTestId('bestand-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bestand', exact: true })).toBeVisible();
  await expect(page.getByTestId('bestand-tab-panels')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('bestand-tab-types')).toBeVisible();

  await page.getByRole('button', { name: 'Plattenbestand bearbeiten' }).click();
  await expect(page.getByLabel('Plattenetikett')).toBeVisible();
  // Door stock must not satisfy Glattwand shortage checks in later e2e (shared workspace DB).
  await page.getByLabel('Wandtyp').selectOption('doorLeft');
  await page.getByLabel('Plattenetikett').fill('Bestand-P01');
  await page.getByRole('button', { name: 'Platte anlegen' }).click();
  await expect(page.getByText(/Bestand-P01 · Türwand/)).toBeVisible();

  await page.getByTestId('bestand-tab-types').click();
  await expect(page.getByTestId('bestand-types')).toBeVisible();
  const acquireTypes = page.getByRole('button', { name: 'Wandtypen bearbeiten' });
  if (await acquireTypes.isVisible()) await acquireTypes.click();
  await expect(page.getByRole('button', { name: 'Wandtyp anlegen' })).toBeVisible();
  await page.getByLabel('Vorlage aus Bestandsarten').selectOption('plain');
  await page.getByRole('button', { name: 'Wandtyp anlegen' }).click();
  await expect(page.getByLabel('Wandtyp-Bezeichnung')).toHaveValue('Glattwand');
  await page.getByLabel('Wandtyp-Bezeichnung').fill('Bestand-Glattwand');
  await page.getByRole('button', { name: 'Wandtyp speichern' }).click();
  await expect(page.locator('#wall-type-selection')).toContainText('Bestand-Glattwand');
  // Leave Bestand so useEditingLease can POST /lease/release. Playwright page
  // teardown aborts that async cleanup and would otherwise leave inventory leased.
  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Produktionen/ }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  expect(errors).toEqual([]);
});
