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
  // Distinct size so this stock type does not satisfy default Glattwand shortage checks in later e2e.
  await page.getByLabel('Außenbreite (mm)').fill('1100');
  await page.getByRole('button', { name: 'Wandtyp speichern' }).click();
  await expect(page.locator('#wall-type-selection')).toContainText('Bestand-Glattwand');

  await page.getByTestId('bestand-tab-panels').click();
  await expect(page.getByTestId('bestand-tab-panels')).toHaveAttribute('aria-selected', 'true');
  const acquirePanels = page.getByRole('button', { name: 'Plattenbestand bearbeiten' });
  if (await acquirePanels.isVisible()) await acquirePanels.click();
  await expect(page.getByLabel('Wandtyp')).toContainText('Bestand-Glattwand');
  await page.getByLabel('Wandtyp').selectOption({ label: 'Bestand-Glattwand' });
  await page.getByLabel('Plattenetikett').fill('Bestand-P02');
  await page.getByRole('button', { name: 'Platte anlegen' }).click();
  await expect(page.getByText(/Bestand-P02 · Bestand-Glattwand/)).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: 'Bestand-P02 · Bestand-Glattwand' }).getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const editForm = page.locator('form[data-testid^="edit-panel-"]');
  await expect(editForm).toBeVisible();
  await editForm.getByLabel('Plattenetikett').fill('Bestand-P02b');
  await editForm.getByLabel('Reparaturhinweis').fill('Kante nacharbeiten');
  await editForm.getByRole('button', { name: 'Speichern', exact: true }).click();
  const renamed = page.getByRole('listitem').filter({ hasText: 'Bestand-P02b · Bestand-Glattwand' });
  await expect(renamed.getByText('Kante nacharbeiten')).toBeVisible();
  await renamed.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await editForm.getByRole('button', { name: 'Steckdosen-/Kabelausschnitt hinzufügen' }).click();
  await editForm.getByLabel('Von links (mm)').fill('120');
  await editForm.getByLabel('Von unten (mm)').fill('300');
  await editForm.getByLabel('Tapete / Oberflächenhinweis').fill('Blumentapete');
  await editForm.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(renamed.getByText(/1 Technikausschnitte/)).toBeVisible();
  await expect(renamed.getByText('Blumentapete')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/stock-polish-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/stock-polish-desktop.png', fullPage: true });
  await renamed.getByRole('button', { name: 'Platte löschen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Platte löschen', exact: true }).click();
  await expect(renamed).toHaveCount(0);

  // Leave Bestand so useEditingLease can POST /lease/release. Playwright page
  // teardown aborts that async cleanup and would otherwise leave inventory leased.
  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Produktionen/ }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  expect(errors).toEqual([]);
});
