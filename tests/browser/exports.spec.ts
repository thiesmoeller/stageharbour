import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { testAdministrator } from '../helpers/database.js';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-Mail-Adresse').fill(testAdministrator.email);
  await page.getByLabel('Passwort', { exact: true }).fill(testAdministrator.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
}

async function waitUntilSaved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 10_000 });
}

test('export a named frozen construction plan and download it from history', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Neues Bühnenbild' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill('Exportprobe');
  await page.getByRole('textbox', { name: 'Spielstätte' }).fill('Probesaal');
  await page.getByRole('textbox', { name: 'Szene' }).fill('Erste Szene');
  await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill('8000');
  await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill('6000');
  await page.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Erste Szene' })).toBeVisible();
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Wand hinzufügen' }).click();
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Montagenummern vergeben' }).click();
  await waitUntilSaved(page);
  await expect(page.locator('[data-testid^="assembly-label-"]')).toHaveText(['Position 1']);
  await page.getByRole('button', { name: 'Konstruktionsplan' }).click();
  await page.getByLabel('Bezeichnung der Fassung').fill('Probeexport');
  await page.getByRole('button', { name: 'Als Konstruktionsplan exportieren' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('Fertig');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = readFileSync(await download.path() as string);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = [...bytes.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  expect(text).toContain('Position 1');
  expect(text).toContain('Verbindungskompatibilität prüft die Crew manuell');
});
