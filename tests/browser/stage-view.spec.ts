import { openInspector, placeNamedObjectAt, placeWallAt } from '../helpers/inspector.js';
import { test, expect, type Page } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';

async function waitUntilSaved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
}

test('edits in the plan update the linked 3D view, including front orientation after rotation, undo and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Raumprobe',
    venueName: 'Probebühne',
    sceneName: 'Drehansicht',
  });
  await expect(page.getByRole('heading', { name: 'Drehansicht' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Grundriss der Spielstätte' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Raumsicht der Spielstätte' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publikumssicht' })).toBeVisible();
  await expect(page.getByText('Vorderseite (Sperrholz, dunkel)')).toBeVisible();
  await expect(page.getByText('Rückseite (Holzrahmen, hell)')).toBeVisible();
  await expect(page.getByRole('button', { name: /Licht|Leuchte|Scheinwerfer/ })).toHaveCount(0);

  await placeWallAt(page);
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

  await placeNamedObjectAt(page, 'Stütze hinzufügen');
  const stageBrace = page.locator('[data-testid^="stage-brace-"]');
  await expect(page.locator('[data-testid^="brace-"]')).toHaveCount(1);
  await expect(stageBrace).toHaveCount(1);
  await expect(stageBrace).toHaveAttribute('data-x', '4000');
  await expect(stageBrace).toHaveAttribute('data-z', '3000');
  await expect(stageBrace).toHaveAttribute('data-y', '600');
  await expect(stageBrace).toHaveAttribute('data-height', '1200');
  await expect(stageBrace).toHaveAttribute('data-footprint-width', '40');
  await expect(stageBrace).toHaveAttribute('data-footprint-depth', '500');
  await waitUntilSaved(page);
  await page.getByLabel('X (mm)').fill('2200');
  await page.getByLabel('Stützenhöhe (mm)').fill('1500');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(stageBrace).toHaveAttribute('data-x', '2200');
  await expect(stageBrace).toHaveAttribute('data-height', '1500');
  await expect(stageBrace).toHaveAttribute('data-y', '750');
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(stageBrace).toHaveAttribute('data-x', '4000');
  await expect(stageBrace).toHaveAttribute('data-height', '1200');
  await page.getByRole('button', { name: 'Wiederholen' }).click();
  await expect(stageBrace).toHaveAttribute('data-x', '2200');
  await waitUntilSaved(page);

  await placeNamedObjectAt(page, 'Tisch hinzufügen');
  const stageTable = page.locator('[data-testid^="stage-placeholder-"]');
  await expect(page.locator('.plan-canvas [data-testid^="placeholder-"]')).toHaveCount(1);
  await expect(stageTable).toHaveCount(1);
  await expect(stageTable).toHaveAttribute('data-x', '4000');
  await expect(stageTable).toHaveAttribute('data-z', '3000');
  await expect(stageTable).toHaveAttribute('data-y', '375');
  await expect(stageTable).toHaveAttribute('data-height', '750');
  await expect(stageTable).toHaveAttribute('data-width', '1200');
  await expect(stageTable).toHaveAttribute('data-depth', '800');
  await page.locator('#placeholder-x').fill('1000');
  await page.locator('#placeholder-y').fill('1000');
  await page.locator('#placeholder-x').locator('xpath=ancestor::form').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(stageTable).toHaveAttribute('data-x', '1000');
  await expect(stageTable).toHaveAttribute('data-z', '1000');
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Spielstätte' }).click();
  await openInspector(page, 'Überbauung');
  await page.getByRole('button', { name: 'Überbauung hinzufügen' }).click();
  await expect(page.getByLabel('Überbauung 1 Unterkante über Fußboden (mm)')).toHaveValue('2600');
  const savedVenue = page.waitForResponse(response => /\/scenes\/[^/]+\/venue$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Spielstätte speichern' }).click();
  expect((await savedVenue).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Spielstätte schließen' }).click();
  await expect(page.locator('[data-testid^="overhead-box-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="stage-overhead-"]')).toHaveAttribute('data-bottom', '2600');
  await expect(page.locator('[data-testid^="stage-overhead-"]')).toHaveAttribute('data-thickness', '400');

  await placeNamedObjectAt(page, 'Podest hinzufügen');
  await expect(page.locator('[data-testid^="platform-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="stage-platform-"]')).toHaveAttribute('data-elevation', '400');
  await placeNamedObjectAt(page, 'Treppe hinzufügen');
  await expect(page.locator('[data-testid^="stage-stair-"]')).toHaveAttribute('data-rise', '400');
  await waitUntilSaved(page);
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  // Podest sits under the wall → Auflagefläche is assigned automatically.
  await expect(page.getByLabel('Auflagefläche')).toHaveValue(/Podest \(400 mm\)/);
  await expect(stageWall).toHaveAttribute('data-y', '1600');
  await expect(page.getByTestId('overhead-warning')).toContainText('ragt von der Auflagefläche in die Überbauung');
  await expect(page.getByTestId('overhead-warning')).toContainText('kein statischer Nachweis');
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('[data-testid^="stage-stair-"]')).toHaveCount(0);
  await expect(stageWall).toHaveAttribute('data-y', '1600');
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(stageWall).toHaveAttribute('data-y', '1200');
  await page.getByRole('button', { name: 'Wiederholen' }).click();
  await expect(stageWall).toHaveAttribute('data-y', '1600');
  await page.getByRole('button', { name: 'Wiederholen' }).click();
  await expect(page.locator('[data-testid^="stage-stair-"]')).toHaveCount(1);
  await waitUntilSaved(page);

  await page.getByTestId('stage-view').getByRole('button', { name: 'Publikumssicht' }).click();
  await expect(page.getByTestId('stage-view')).toHaveAttribute('data-view', 'audience');
  await page.getByRole('button', { name: 'Umlaufansicht' }).click();
  await expect(page.getByTestId('stage-view')).toHaveAttribute('data-view', 'orbit');

  await page.reload();
  const workspace = page.getByRole('region', { name: 'Bühnenbild bearbeiten' });
  try {
    await workspace.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    await page.getByRole('button', { name: /Raumprobe · Drehansicht/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Drehansicht' })).toBeVisible();
  await expect(planWall).toHaveCount(1);
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveAttribute('data-x', '2500');
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveAttribute('data-z', '3000');
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveAttribute('data-y', '1600');
  await expect(page.locator('[data-testid^="stage-wall-"]')).toContainText('Vorderseite zeigt nach rechts');
  await expect(page.locator('[data-testid^="brace-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="stage-brace-"]')).toHaveAttribute('data-x', '2200');
  await expect(page.locator('[data-testid^="stage-brace-"]')).toHaveAttribute('data-height', '1500');
  await expect(page.locator('[data-testid^="stage-platform-"]')).toHaveAttribute('data-elevation', '400');
  await expect(page.locator('[data-testid^="stage-stair-"]')).toHaveAttribute('data-rise', '400');
  await expect(page.locator('.plan-canvas [data-testid^="placeholder-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="stage-placeholder-"]')).toHaveAttribute('data-x', '1000');
  await expect(page.locator('[data-testid^="stage-placeholder-"]')).toHaveAttribute('data-z', '1000');
  await expect(page.locator('[data-testid^="stage-placeholder-"]')).toHaveAttribute('data-height', '750');
  await expect(page.locator('[data-testid^="stage-placeholder-"]')).toHaveAttribute('data-width', '1200');
  await expect(page.locator('[data-testid^="stage-placeholder-"]')).toHaveAttribute('data-depth', '800');

  await placeWallAt(page);
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(2);
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await page.locator('[data-testid^="wall-"]').nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Gruppieren' }).click();
  await page.getByLabel('Drehpunkt X (mm)').fill('4250');
  await page.locator('.group-panel').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('[data-testid^="stage-wall-"]').nth(0)).toHaveAttribute('data-x', '3500');
  await expect(page.locator('[data-testid^="stage-wall-"]').nth(1)).toHaveAttribute('data-x', '5000');
  await waitUntilSaved(page);
  expect(errors).toEqual([]);
});

