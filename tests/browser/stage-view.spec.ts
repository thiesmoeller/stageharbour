import { expect, test } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { placeNamedObjectAt, placeWallAt } from '../helpers/inspector.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test('generic layout objects update the resolved 3D view, undo and reload', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Raumprobe',
    venueName: 'Probebühne',
    sceneName: 'Drehansicht',
  });

  await revealEditorCommand(page, 'Geteilt');
  await page.getByRole('button', { name: 'Geteilt', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Grundriss der Spielstätte' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Raumsicht der Spielstätte' })).toBeVisible();

  await placeWallAt(page);
  await page.getByLabel('X (mm)').fill('2500');
  await page.getByLabel('Drehung (°)').fill('90');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('[data-testid^="stage-object-"]')).toHaveCount(1);

  await placeNamedObjectAt(page, 'Stütze hinzufügen', 2200, 2500);
  await placeNamedObjectAt(page, 'Tisch hinzufügen', 3500, 1800);
  await placeNamedObjectAt(page, 'Podest hinzufügen', 5200, 3500);
  await placeNamedObjectAt(page, 'Treppe hinzufügen', 6500, 3500);
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(5);
  await expect(page.locator('[data-testid^="stage-object-"]')).toHaveCount(5);
  await expect(page.locator('[data-renderer="stage"] canvas')).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');

  await revealEditorCommand(page, 'Rückgängig');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('[data-testid^="stage-object-"]')).toHaveCount(4);
  await revealEditorCommand(page, 'Wiederholen');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.locator('[data-testid^="stage-object-"]')).toHaveCount(5);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');

  await page.reload();
  await revealEditorCommand(page, 'Geteilt');
  await page.getByRole('button', { name: 'Geteilt', exact: true }).click();
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(5);
  await expect(page.locator('[data-testid^="stage-object-"]')).toHaveCount(5);
  await expect(page.getByText('Wandelement · Glattwand: Wandelement')).toHaveCount(1);
  expect(errors).toEqual([]);
});
