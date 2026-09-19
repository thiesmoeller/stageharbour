import { test, expect, type Page } from '@playwright/test';
import { testAdministrator, testEditor } from '../helpers/database.js';
import { placeWallAt } from '../helpers/inspector.js';

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('E-Mail-Adresse').fill(account.email);
  await page.getByLabel('Passwort', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
}

test('a second session sees who is editing and cannot modify the plan', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const editorContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const editorPage = await editorContext.newPage();
  await signIn(adminPage, testAdministrator);
  await adminPage.getByRole('button', { name: 'Neues Bühnenbild' }).click();
  await adminPage.getByRole('textbox', { name: 'Produktion' }).fill('Pachtprobe');
  await adminPage.getByRole('textbox', { name: 'Spielstätte' }).fill('Probesaal');
  await adminPage.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill('8000');
  await adminPage.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill('6000');
  await adminPage.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Szene 1' })).toBeVisible();
  await expect(adminPage.getByRole('button', { name: 'Wand hinzufügen' })).toBeVisible();
  await expect(adminPage.locator('.save-status')).toHaveText('Gespeichert', { timeout: 10_000 });

  await signIn(editorPage, testEditor);
  const card = editorPage.getByRole('button', { name: /Pachtprobe · Szene 1/ });
  await expect(card).toContainText('Bearbeitung durch Test Administration');
  await card.click();
  await expect(editorPage.getByRole('heading', { name: 'Szene 1' })).toBeVisible();
  await expect(editorPage.getByText('Nur Ansicht · Bearbeitung durch Test Administration')).toBeVisible();
  await expect(editorPage.getByRole('button', { name: 'Wand hinzufügen' })).toHaveCount(0);

  await adminPage.getByRole('button', { name: 'Zur Übersicht', exact: true }).click();
  await editorPage.getByRole('button', { name: 'Bearbeitung erneut anfordern', exact: true }).click();
  await expect(editorPage.getByRole('button', { name: 'Wand hinzufügen' })).toBeVisible();
  await expect(editorPage.locator('.save-status')).toHaveText('Gespeichert');

  await adminContext.close();
  await editorContext.close();
});

test('venue editing shows the holder and becomes writable after release', async ({ browser }) => {
  const admin = await browser.newContext(), editor = await browser.newContext();
  const first = await admin.newPage(), second = await editor.newPage();
  try {
    await signIn(first, testAdministrator);
    await first.getByRole('button', { name: /Spielstätten & Bühnen/ }).click();
    await first.getByRole('button', { name: 'Neue Spielstätte', exact: true }).click();
    await first.getByLabel('Name der Spielstätte').fill('Gemeinsamer Saal');
    await first.getByRole('button', { name: 'Spielstätte anlegen', exact: true }).click();
    await expect(first.getByText('Sie bearbeiten diesen Bereich.', { exact: true })).toBeVisible();
    await signIn(second, testEditor);
    await second.getByRole('button', { name: /Spielstätten & Bühnen/ }).click();
    await second.getByRole('button', { name: /Gemeinsamer Saal.*gestalten/ }).click();
    await expect(second.getByText('Wird bereits von Test Administration bearbeitet.')).toBeVisible();
    await expect(second.getByRole('button', { name: 'Feste Wand setzen' })).toHaveCount(0);
    await first.getByRole('button', { name: 'Zur Spielstättenübersicht' }).click();
    await second.getByRole('button', { name: 'Bearbeitung erneut anfordern' }).click();
    await expect(second.getByRole('button', { name: 'Feste Wand setzen' })).toBeVisible();
  } finally { await admin.close(); await editor.close(); }
});

test('lease loss preserves the local scene and offers separate template recovery', async ({ page }) => {
  await signIn(page, testAdministrator);
  await page.getByRole('button', { name: 'Neues Bühnenbild' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill('Entwurfsrettung');
  await page.getByRole('textbox', { name: 'Spielstätte' }).fill('Probebühne');
  await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill('8000');
  await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill('6000');
  await page.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(page.getByRole('button', { name: 'Wand hinzufügen' })).toBeVisible();
  await page.route('**/scenes/*/layout', route => route.fulfill({ status: 423, contentType: 'application/json', body: JSON.stringify({ message: 'Bearbeitung abgelaufen' }) }));
  await placeWallAt(page);
  await expect(page.locator('.save-status')).toHaveText('Bearbeitung abgelaufen');
  await expect(page.getByRole('button', { name: 'Wand hinzufügen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lokalen Entwurf herunterladen' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept('Gerettete Probebühne'));
  const saved = page.waitForResponse(response => response.url().endsWith('/recover') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Entwurf als Szenenvorlage sichern' }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect((await response.json()).layout.walls).toHaveLength(1);
  await expect(page.getByText('Entwurf als Szenenvorlage gesichert. Sie finden ihn in der Übersicht.')).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('Bearbeitung abgelaufen');
});
