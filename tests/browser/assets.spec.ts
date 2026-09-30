import { test, expect } from '@playwright/test';
import { commitWallPlacement, commitObjectPlacement, planWalls } from '../helpers/inspector.js';
import { cubeGlb } from '../helpers/model.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test('inventory, GLB models and Pascal catalogue items participate in placement, undo and saved layouts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://byrpxoiotywskoojsrzd.supabase.co/**', route => route.request().url().endsWith('.glb')
    ? route.fulfill({ contentType: 'model/gltf-binary', body: cubeGlb() }) : route.fulfill({ status: 204 }));
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Inventarprobe',
    venueName: 'Probebühne',
    sceneName: 'Objekte',
  });
  await page.getByRole('button', { name: '2D + 3D', exact: true }).click();
  await page.getByRole('button', { name: 'Objektbibliothek', exact: true }).click();
  const library = page.getByRole('region', { name: 'Objektbibliothek' });
  await library.getByLabel('Name der Objektvorlage').fill('Standardkulisse');
  await library.getByRole('button', { name: 'Objektvorlage speichern' }).click();
  const wallCard = library.locator('article').filter({ hasText: 'Standardkulisse' });
  await wallCard.getByRole('button', { name: 'Platzieren' }).click();
  await commitWallPlacement(page);
  await expect(planWalls(page)).toHaveCount(1);
  await expect(page.getByLabel('Dicke (mm)')).toHaveValue('28');
  const surfaces = page.getByTestId('surface-editor');
  await expect(surfaces).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('surface-uniform Art').selectOption('library');
  await expect(page.getByLabel('surface-uniform Bibliothek')).toBeVisible();
  await page.getByLabel('surface-uniform Bibliothek').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Objektbibliothek', exact: true }).click();
  await library.getByRole('button', { name: 'GLB importieren', exact: true }).click();
  await library.getByLabel('Modellname').fill('Testpodest');
  await library.getByLabel('GLB-Datei').setInputFiles({ name: 'cube.glb', mimeType: 'model/gltf-binary', buffer: cubeGlb() });
  await expect(library.getByText(/Dateimaße/)).toBeVisible();
  await library.getByLabel('Bekanntes Außenmaß').selectOption('height');
  await library.getByLabel('Höhe (mm)').fill('900');
  await expect(library.getByText(/Ergebnis: 900 × 900 × 900 mm/)).toBeVisible();
  await library.getByRole('button', { name: 'Modell in Objektvorlagen importieren' }).click();
  const modelCard = library.locator('article').filter({ hasText: 'Testpodest' });
  await modelCard.getByRole('button', { name: 'Platzieren' }).click();
  await expect(page.getByTestId('placing-object')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Objektbibliothek', exact: true }).click();
  await modelCard.getByRole('button', { name: 'Platzieren' }).click();
  await commitObjectPlacement(page);
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(1);
  await page.getByLabel('X (mm)', { exact: true }).fill('2200');
  await page.getByLabel('Drehung (°)').fill('90');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('[data-testid^="stage-placeholder-"]')).toHaveAttribute('data-x', '2200');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('0');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('90');

  await page.getByRole('button', { name: 'Objektbibliothek', exact: true }).click();
  await library.getByRole('button', { name: 'Pascal-Katalog', exact: true }).click();
  await library.getByLabel('Pascal-Katalog durchsuchen').fill('Cactus');
  await library.getByRole('button', { name: 'In Objektvorlagen übernehmen' }).first().click();
  await library.locator('article').filter({ hasText: 'Cactus' }).getByRole('button', { name: 'Platzieren' }).click();
  await commitObjectPlacement(page, 5000, 3000);
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Objektbibliothek', exact: true }).click();
  await modelCard.getByRole('button', { name: 'Archivieren' }).click();
  await expect(modelCard).toHaveCount(0);
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(2);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Objektbibliothek', exact: true }).click();
  await page.locator('.render-settings > summary').click();
  await page.getByLabel('Umgebung').selectOption('paper');
  await page.locator('.render-settings > summary').click();
  await page.getByTestId('stage-view').screenshot({ path: 'test-results/pascal-stage.png' });
  await expect(page.locator('.model-error')).toHaveCount(0);

  await page.reload();
  const workspace = page.getByRole('region', { name: 'Szene bearbeiten' });
  try {
    await workspace.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    await page.getByRole('region', { name: 'Produktion Inventarprobe', exact: true }).getByRole('button', { name: /Inventarprobe · Objekte/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Objekte' })).toBeVisible();
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(2);
  await page.getByLabel('Auswahl', { exact: true }).selectOption(await page.locator('#wall-selection option').filter({ hasText: 'Testpodest' }).getAttribute('value') as string);
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('2200');
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('90');
  await page.getByRole('button', { name: 'Platzhalter löschen' }).click();
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(2);
  expect(errors).toEqual([]);
});
