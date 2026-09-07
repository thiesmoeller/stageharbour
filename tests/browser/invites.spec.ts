import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { testAdministrator } from '../helpers/database.js';
import { mailboxPath } from '../helpers/mailbox.js';

const editor = { email: 'editorin@example.test', name: 'Editorin Beispiel', password: 'editor-password-7319' };

test('administrator invites an editor who sets a password and opens the workspace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('E-Mail-Adresse').fill(testAdministrator.email);
  await page.getByLabel('Passwort', { exact: true }).fill(testAdministrator.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(editor.name);
  await page.getByLabel('E-Mail-Adresse').fill(editor.email);
  await page.getByLabel('Berechtigung', { exact: true }).selectOption('editor');
  await page.getByRole('button', { name: 'Einladen', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(`Einladung wurde an ${editor.email} gesendet.`);
  const mailbox = JSON.parse(await readFile(mailboxPath, 'utf8')) as Array<{ text: string }>;
  const match = mailbox.at(-1)?.text.match(/https?:\/\/[^\s]+#\/einladung\/[A-Za-z0-9_-]+/);
  expect(match).toBeTruthy();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await page.goto(match![0]!);
  await expect(page.getByRole('heading', { name: 'Konto einrichten' })).toBeVisible();
  await page.getByLabel('Passwort', { exact: true }).fill(editor.password);
  await page.getByLabel('Passwort bestätigen').fill(editor.password);
  await page.getByRole('button', { name: 'Passwort speichern' }).click();
  await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
  await page.getByLabel('E-Mail-Adresse').fill(editor.email);
  await page.getByLabel('Passwort', { exact: true }).fill(editor.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
  await expect(page.getByText('Angemeldet als Editorin Beispiel')).toBeVisible();
  await expect(page.getByText('Bearbeitung', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mitglieder' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
