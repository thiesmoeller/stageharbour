import { test, expect, type Page } from '@playwright/test';
import { testAdministrator, testEditor } from '../helpers/database.js';

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

  await adminContext.close();
  await editorContext.close();
});
