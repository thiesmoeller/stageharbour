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
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('A4');
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('1:50');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('listitem').filter({ hasText: 'Probeexport' }).getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = readFileSync(await download.path() as string);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = [...bytes.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  expect(text).toContain('Position 1');
  expect(text).toContain('Verbindungskompatibilität prüft die Crew manuell');
  expect(text).toContain('Maßstab 1:50');
  await page.getByLabel('Papierformat').selectOption('A3');
  await page.getByLabel('Maßstab').selectOption('25');
  await page.getByLabel('Bezeichnung der Fassung').fill('A3-Detail');
  await page.getByRole('button', { name: 'Als Konstruktionsplan exportieren' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'A3-Detail' })).toContainText('Fertig');
  await expect(page.getByRole('listitem').filter({ hasText: 'A3-Detail' })).toContainText('A3');
  await expect(page.getByRole('listitem').filter({ hasText: 'A3-Detail' })).toContainText('1:25');
  const [a3Download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('listitem').filter({ hasText: 'A3-Detail' }).getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  const a3Bytes = readFileSync(await a3Download.path() as string);
  expect(a3Bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(a3Bytes.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 1190\.55\]/);
  await page.getByRole('button', { name: 'Wand hinzufügen' }).click();
  await waitUntilSaved(page);
  await page.getByLabel('Auswahl').selectOption({ label: '1. Wand' });
  await page.locator('[data-testid^="wall-"]').nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Gruppieren' }).click();
  await waitUntilSaved(page);
  await page.getByRole('checkbox', { name: /Gruppe 1/ }).check();
  await page.getByLabel('Bezeichnung der Fassung').fill('Ansichtsexport');
  await page.getByLabel('Papierformat').selectOption('A4');
  await page.getByLabel('Maßstab').selectOption('50');
  await page.getByRole('button', { name: 'Als Konstruktionsplan exportieren' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Ansichtsexport' })).toContainText('Fertig');
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('A4');
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('1:50');
  const [elevationDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('listitem').filter({ hasText: 'Ansichtsexport' }).getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  const elevationBytes = readFileSync(await elevationDownload.path() as string);
  expect(elevationBytes.subarray(0, 5).toString()).toBe('%PDF-');
  const elevationText = [...elevationBytes.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  expect(elevationText).toContain('Frontansicht');
  expect(elevationText).toContain('Ansicht 0°');
  expect(elevationText).toContain('Maßstab 1:50');
  expect(elevationBytes.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  await page.getByLabel('Bezeichnung des Pakets').fill('Paketexport');
  await page.getByRole('button', { name: 'Als Konstruktionspaket exportieren' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Paketexport' })).toContainText('Fertig');
  await expect(page.getByRole('listitem').filter({ hasText: 'Paketexport' })).toContainText('A4');
  await expect(page.getByRole('listitem').filter({ hasText: 'Paketexport' })).toContainText('1:50');
  const [packageDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('listitem').filter({ hasText: 'Paketexport' }).getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  expect(packageDownload.suggestedFilename()).toMatch(/konstruktionspaket-.*\.pdf$/);
  const packageBytes = readFileSync(await packageDownload.path() as string);
  expect(packageBytes.subarray(0, 5).toString()).toBe('%PDF-');
  const packageText = [...packageBytes.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  expect(packageText).toContain('Stückliste');
  expect(packageText).toContain('Konstruktionspaket');
  expect(packageText).toContain('Maßstab 1:50');
  expect(packageBytes.toString('latin1')).toMatch(/\/MediaBox \[ ?0 0 595\.28 841\.89 ?\]/);
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('A4');
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('1:50');
});
