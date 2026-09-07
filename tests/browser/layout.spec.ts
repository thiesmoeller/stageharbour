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

test('create a layout, move a panel, undo the move, and reload the saved result', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.getByRole('button', { name: 'Neues Bühnenbild' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill('Beispielproduktion');
  await page.getByRole('textbox', { name: 'Spielstätte' }).fill('Beispielsaal');
  await page.getByRole('textbox', { name: 'Szene' }).fill('Erste Szene');
  await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill('8000');
  await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill('6000');
  await page.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Erste Szene' })).toBeVisible();
  await expect(page.getByText('Beispielproduktion · Beispielsaal')).toBeVisible();
  await expect(page.getByText('↑ Publikum · Blick zur Bühne')).toBeVisible();
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Wand hinzufügen' }).click();
  const wall = page.locator('[data-testid^="wall-"]');
  await expect(wall).toHaveCount(1);
  await expect(page.getByLabel('Breite (mm)')).toHaveValue('1200');
  await expect(page.getByLabel('Höhe (mm)')).toHaveValue('2400');
  await expect(page.getByLabel('Dicke (mm)')).toHaveValue('28');
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Y (mm)')).toHaveValue('3000');
  await waitUntilSaved(page);

  await page.getByLabel('X (mm)').fill('2500');
  await page.getByLabel('Drehung (°)').fill('35');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('2500');
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('0');
  await waitUntilSaved(page);

  const box = await wall.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 - 40);
  await page.mouse.up();
  await expect(page.getByLabel('X (mm)')).not.toHaveValue('4000');
  const movedX = await page.getByLabel('X (mm)').inputValue();
  const movedY = await page.getByLabel('Y (mm)').inputValue();
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Y (mm)')).toHaveValue('3000');
  await waitUntilSaved(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
  await page.getByRole('button', { name: /Beispielproduktion · Erste Szene/ }).click();
  await expect(page.getByRole('heading', { name: 'Erste Szene' })).toBeVisible();
  await expect(wall).toHaveCount(1);
  await wall.click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Y (mm)')).toHaveValue('3000');
  await expect(page.getByLabel('X (mm)')).not.toHaveValue(movedX);
  await expect(page.getByLabel('Y (mm)')).not.toHaveValue(movedY);
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Wiederholen' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/layout-editor.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('create a wall type with a rectangular opening, place it, and export the plan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.getByRole('button', { name: 'Neues Bühnenbild' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill('Türproduktion');
  await page.getByRole('textbox', { name: 'Spielstätte' }).fill('Türsaal');
  await page.getByRole('textbox', { name: 'Szene' }).fill('Türszene');
  await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill('8000');
  await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill('6000');
  await page.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Türszene' })).toBeVisible();
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Wandtyp anlegen' }).click();
  await page.getByLabel('Wandtyp-Bezeichnung').fill('Türwand');
  await page.getByRole('button', { name: 'Öffnung hinzufügen' }).click();
  await expect(page.getByLabel('Öffnungsbreite (mm)')).toHaveValue('800');
  await page.getByLabel('Öffnungsbreite (mm)').fill('2000');
  await page.getByRole('button', { name: 'Wandtyp speichern' }).click();
  await expect(page.getByRole('alert')).toContainText('innerhalb der Platte');
  await page.getByLabel('Öffnungsbreite (mm)').fill('800');
  await page.getByRole('button', { name: 'Wandtyp speichern' }).click();
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Wandtyp platzieren' }).click();
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(1);
  const opening = page.locator('[data-testid^="plan-opening-"]');
  await expect(opening).toHaveCount(1);
  await expect(opening).toHaveAttribute('data-width', '800');
  await expect(opening).toHaveAttribute('data-height', '2000');
  await expect(opening).toHaveAttribute('data-left', '200');
  const stageWall = page.locator('[data-testid^="stage-wall-"]');
  await expect(stageWall).toHaveAttribute('data-opening-count', '1');
  await expect(stageWall).toHaveAttribute('data-opening-width', '800');
  await expect(stageWall).toHaveAttribute('data-opening-height', '2000');
  await expect(stageWall).toHaveAttribute('data-width', '1200');
  await expect(stageWall).toHaveAttribute('data-height', '2400');
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Konstruktionsplan' }).click();
  await page.getByLabel('Bezeichnung der Fassung').fill('Türfassung');
  await page.getByRole('button', { name: 'Als Konstruktionsplan exportieren' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Türfassung' })).toContainText('Fertig');
  expect(errors).toEqual([]);
});

test('a failed autosave keeps the local draft and retries the same revision', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Neues Bühnenbild' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill('Netzwerkprobe');
  await page.getByRole('textbox', { name: 'Spielstätte' }).fill('Probesaal');
  await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill('8000');
  await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill('6000');
  await page.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Szene 1' })).toBeVisible();
  await waitUntilSaved(page);

  await page.route('**/api/workspaces/**/scenes/**/layout', route => route.abort());
  await page.getByRole('button', { name: 'Wand hinzufügen' }).click();
  await expect(page.getByRole('alert')).toContainText('noch nicht gespeichert');
  await expect(page.locator('.save-status')).toHaveText('Speichern fehlgeschlagen');
  await page.unroute('**/api/workspaces/**/scenes/**/layout');
  await page.getByRole('button', { name: 'Speichern erneut versuchen' }).click();
  await waitUntilSaved(page);
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: /Netzwerkprobe · Szene 1/ }).click();
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(1);
});
