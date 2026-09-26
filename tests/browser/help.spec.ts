import { test, expect } from '@playwright/test';
import { signInToPlans } from '../helpers/plans.js';

test('online help page documents tools, shortcuts and wall surfaces', async ({ page }) => {
  await signInToPlans(page);
  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Hilfe/ }).click();
  await expect(page).toHaveURL(/#\/hilfe/);
  await expect(page.getByRole('heading', { name: 'Bedienung des Bühnenplaners' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tastatur' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wandoberflächen' })).toBeVisible();
  await expect(page.getByText('Alle Seiten gleich')).toBeVisible();
  await expect(page.getByText('Zwei Streifen')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wandoberflächen' })).toBeVisible();
});
