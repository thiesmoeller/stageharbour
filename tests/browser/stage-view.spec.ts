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

test('edits in the plan update the linked 3D view, including front orientation after rotation, undo and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.getByRole('button', { name: 'Neues Bühnenbild' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill('Raumprobe');
  await page.getByRole('textbox', { name: 'Spielstätte' }).fill('Probebühne');
  await page.getByRole('textbox', { name: 'Szene' }).fill('Drehansicht');
  await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill('8000');
  await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill('6000');
  await page.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Drehansicht' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Grundriss der Spielstätte' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Raumsicht der Spielstätte' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publikumssicht' })).toBeVisible();
  await expect(page.getByText('Vorderseite (Sperrholz, dunkel)')).toBeVisible();
  await expect(page.getByText('Rückseite (Holzrahmen, hell)')).toBeVisible();
  await expect(page.getByRole('button', { name: /Licht|Leuchte|Scheinwerfer/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Wand hinzufügen' }).click();
  const planWall = page.locator('[data-testid^="wall-"]');
  const stageWall = page.locator('[data-testid^="stage-wall-"]');
  await expect(planWall).toHaveCount(1);
  await expect(stageWall).toHaveCount(1);
  await expect(stageWall).toHaveAttribute('data-x', '4000');
  await expect(stageWall).toHaveAttribute('data-z', '3000');
  await expect(stageWall).toHaveAttribute('data-y', '1200');
  await expect(stageWall).toHaveAttribute('data-height', '2400');
  await expect(stageWall).toHaveAttribute('data-width', '1200');
  await expect(stageWall).toHaveAttribute('data-thickness', '28');
  await expect(stageWall).toContainText('Vorderseite zeigt zum Publikum');
  await waitUntilSaved(page);

  await page.getByLabel('X (mm)').fill('2500');
  await page.getByLabel('Drehung (°)').fill('90');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('2500');
  await expect(stageWall).toHaveAttribute('data-x', '2500');
  await expect(stageWall).toHaveAttribute('data-z', '3000');
  await expect(stageWall).toHaveAttribute('data-y', '1200');
  await expect(stageWall).toContainText('Vorderseite zeigt nach rechts');
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('0');
  await expect(stageWall).toHaveAttribute('data-x', '4000');
  await expect(stageWall).toContainText('Vorderseite zeigt zum Publikum');
  await page.getByRole('button', { name: 'Wiederholen' }).click();
  await expect(stageWall).toHaveAttribute('data-x', '2500');
  await expect(stageWall).toContainText('Vorderseite zeigt nach rechts');
  await waitUntilSaved(page);

  await page.getByTestId('stage-view').getByRole('button', { name: 'Publikumssicht' }).click();
  await expect(page.getByTestId('stage-view')).toHaveAttribute('data-view', 'audience');
  await page.getByRole('button', { name: 'Umlaufansicht' }).click();
  await expect(page.getByTestId('stage-view')).toHaveAttribute('data-view', 'orbit');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
  await page.getByRole('button', { name: /Raumprobe · Drehansicht/ }).click();
  await expect(page.getByRole('heading', { name: 'Drehansicht' })).toBeVisible();
  await expect(planWall).toHaveCount(1);
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveAttribute('data-x', '2500');
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveAttribute('data-z', '3000');
  await expect(page.locator('[data-testid^="stage-wall-"]')).toContainText('Vorderseite zeigt nach rechts');
  expect(errors).toEqual([]);
});
