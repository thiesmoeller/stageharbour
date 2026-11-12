import { expect, test } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { openLibrary, placeWallAt, showProperties } from '../helpers/inspector.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test('generic part editor keeps plan, dock and 3D usable across viewport sizes', async ({ page }) => {
  test.setTimeout(process.env.CI ? 120_000 : 60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Der eingebildete Kranke',
    venueName: 'Theatersaal',
    sceneName: 'Erster Akt · Das Zimmer',
  });

  await showProperties(page);
  await expect(page.getByRole('heading', { name: 'Keine Auswahl' })).toBeVisible();
  const library = await openLibrary(page);
  await expect(library).toContainText('Wandelement');
  await expect(library).toContainText('Tisch');
  await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();

  for (const [x, y, rotation] of [[2000, 4500, 0], [3200, 4500, 0], [4400, 4500, 0], [5600, 4500, 0], [1400, 3900, 90]]) {
    await placeWallAt(page, x, y);
    await page.locator('#part-x').fill(String(x));
    await page.locator('#part-y').fill(String(y));
    await page.locator('#part-rotation').fill(String(rotation));
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  }
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  const plan = page.getByRole('img', { name: 'Grundriss der Spielstätte', exact: true });
  await expect(plan).toBeInViewport();
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(5);

  await revealEditorCommand(page, 'Raumsicht');
  await page.getByRole('button', { name: 'Raumsicht', exact: true }).click();
  await expect(page.getByTestId('stage-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-renderer="stage"] canvas')).toBeVisible({ timeout: 30_000 });
  for (const [label, view] of [['Von oben', 'top'], ['Von vorne', 'front'], ['Von der Seite', 'side'], ['Publikumssicht', 'audience'], ['Umlaufansicht', 'orbit']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click({ force: true });
    await expect(page.getByTestId('stage-view')).toHaveAttribute('data-view', view);
  }

  await revealEditorCommand(page, 'Geteilt');
  await page.getByRole('button', { name: 'Geteilt', exact: true }).click();
  await expect(plan).toBeVisible();
  await expect(page.locator('[data-renderer="stage"] canvas')).toBeVisible();

  for (const [width, height] of [[1024, 768], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: 'Zur Übersicht' })).toBeInViewport();
    await expect(page.locator('.workspace-statusbar')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Bühnenbilder', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
