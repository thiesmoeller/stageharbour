import { test, expect } from '@playwright/test';
import { testAdministrator } from '../helpers/database.js';

test('German login, failed credentials, workspace, reload, logout and mobile layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
  await page.getByRole('tab', { name: 'Passwort' }).click();
  await page.getByLabel('E-Mail-Adresse').fill(testAdministrator.email);
  await page.getByLabel('Passwort', { exact: true }).fill('wrong-test-password');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Anmeldung fehlgeschlagen');
  await page.getByLabel('Passwort', { exact: true }).fill(testAdministrator.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
  await page.getByRole('button', { name: /Mein Konto/ }).click();
  await expect(page.getByRole('heading', { name: 'Mein Konto' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Passkey', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Verwaltung/ }).click();
  await expect(page.getByRole('cell', { name: testAdministrator.email })).toBeVisible();
  await page.getByRole('button', { name: 'Zugang entziehen', exact: true }).first().click();
  const revoke = page.getByRole('dialog', { name: 'Zugang entziehen?' });
  await expect(revoke).toBeVisible();
  await revoke.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(revoke).toHaveCount(0);
  await expect(page.getByRole('cell', { name: testAdministrator.email })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Verwaltung/, exact: false })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('cell', { name: testAdministrator.email })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Link senden', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Link senden', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Pocket ID sign-in is offered in German when OIDC is configured', async ({ page }) => {
  await page.route('**/api/login-options', route => route.fulfill({ json: { oidc: true, version: 'test' } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mit Pocket ID anmelden' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link senden', exact: true })).toBeVisible();
  await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
});

test('workspace network errors offer a working retry', async ({ page }) => {
  await page.route('**/api/me', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Verbindung unterbrochen' })).toBeVisible();
  await page.unroute('**/api/me');
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
});
