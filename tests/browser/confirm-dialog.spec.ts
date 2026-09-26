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
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();

  const card = page.locator('.scene-card').filter({
    has: page.getByRole('button', { name: 'ConfirmModal · ConfirmSzene ConfirmSaal' }),
  });
  await card.getByText('Weitere Aktionen').click();
  await card.getByRole('button', { name: 'Löschen', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Szene löschen?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('ConfirmModal · ConfirmSzene');
  await expect(dialog.getByRole('button', { name: 'Szene löschen' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ConfirmModal · ConfirmSzene ConfirmSaal' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});
