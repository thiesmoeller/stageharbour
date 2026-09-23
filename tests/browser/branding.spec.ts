import { test, expect } from '@playwright/test';
import { testAdministrator } from '../helpers/database.js';
import { pngBytes } from '../helpers/references.js';

test('administrator can set site branding with a logo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Bühnenplaner Startseite' })).toBeVisible();
  await page.getByLabel('E-Mail-Adresse').fill(testAdministrator.email);
  await page.getByLabel('Passwort', { exact: true }).fill(testAdministrator.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
  await page.getByRole('button', { name: /Verwaltung/ }).click();
  await expect(page.getByRole('heading', { name: 'Darstellung' })).toBeVisible();
  await page.getByRole('heading', { name: 'Darstellung' }).scrollIntoViewIfNeeded();

  await page.getByLabel('Produktname').fill('Probebühne Planer');
  await page.getByLabel('Unterzeile').fill('SELBST GEHOSTET');
  await page.getByLabel('Fußzeile').fill('Für eure eigene Bühne.');
  await page.getByRole('button', { name: 'Darstellung speichern' }).click();
  await expect(page.getByText('Darstellung wurde gespeichert.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Probebühne Planer Startseite' })).toBeVisible();
  await expect(page.getByText('SELBST GEHOSTET')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toHaveText('Für eure eigene Bühne.');

  await page.getByLabel('PNG oder JPEG').setInputFiles({
    name: 'logo.png', mimeType: 'image/png', buffer: pngBytes(24, 24),
  });
  await page.getByRole('button', { name: 'Logo hochladen' }).click();
  await expect(page.getByText('Logo wurde übernommen.')).toBeVisible();
  await expect(page.locator('.brand-logo')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Aktuelles Logo' })).toBeVisible();
});
