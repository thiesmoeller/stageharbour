import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { commitWallPlacement } from '../helpers/inspector.js';

const menu = (page: import('@playwright/test').Page, name: string) => page.locator('.editor-menubar summary').filter({ hasText: new RegExp(`^${name}$`) });

test('single canvas and dock preserve working space, drafts and preferences', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Dock workspace', venueName: 'Dock venue', sceneName: 'Dock stage' });
  const canvas = page.getByRole('img', { name: 'Grundriss der Spielstätte', exact: true });
  await expect(page.getByRole('button', { name: 'Grundriss', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.editor-dock')).toBeHidden();
  await page.setViewportSize({ width: 1366, height: 768 });
  const full = (await canvas.boundingBox())!;
  expect(full.width).toBeGreaterThan(1200);
  expect(full.height).toBeGreaterThan(768 * .84);
  await page.getByRole('button', { name: 'Wand hinzufügen', exact: true }).click();
  await commitWallPlacement(page);
  await page.getByRole('button', { name: 'Eigenschaften', exact: true }).click();
  const reduced = (await canvas.boundingBox())!;
  const dockWidth = (await page.locator('.editor-dock').boundingBox())!.width;
  expect(full.width - reduced.width).toBeCloseTo(dockWidth, 0);
  expect(reduced.height).toBeCloseTo(full.height, 0);
  await page.locator('#wall-x').fill('2500');
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
  await expect(page.locator('.wall-inspector')).toBeHidden();
  await page.getByRole('checkbox', { name: 'Namen', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Eigenschaften', exact: true }).click();
  await expect(page.locator('#wall-x')).toHaveValue('2500');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
  const library = page.getByRole('region', { name: 'Objektbibliothek' });
  await library.getByRole('button', { name: 'Wandtypen', exact: true }).click();
  await library.getByRole('button', { name: 'Wandtyp anlegen' }).click();
  await library.getByLabel('Wandtyp-Bezeichnung').fill('Unfinished wall type');
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
  await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
  await expect(library.getByLabel('Wandtyp-Bezeichnung')).toHaveValue('Unfinished wall type');
  await page.getByRole('button', { name: 'Seitenleiste schließen' }).click();
  await expect(page.getByRole('button', { name: 'Bibliothek', exact: true })).toBeFocused();
  expect((await canvas.boundingBox())!.width).toBe(full.width);
  await page.screenshot({ path: 'test-results/editor-dock-plan.png' });
  await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
  await library.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await page.getByRole('button', { name: 'Seitenleiste anheften' }).click();
  await library.getByRole('button', { name: 'Wandtyp platzieren' }).click();
  await expect(page.getByTestId('placing-wall')).toBeVisible();
  await expect(library).toBeVisible();
  await page.getByRole('button', { name: 'Auswahl', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Seitenleiste anheften' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Bibliothek', exact: true })).toHaveAttribute('aria-expanded', 'true');
});

test('lighting and display settings never reduce 3D canvas height', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Dock lighting', venueName: 'Lighting venue', sceneName: 'Lighting stage' });
  await page.getByRole('button', { name: 'Licht', exact: true }).click();
  await page.getByRole('button', { name: 'Raumansicht öffnen', exact: true }).click();
  const stage = page.locator('[data-renderer="pascal"]');
  await expect(stage.locator('canvas')).toBeVisible({ timeout: 30_000 });
  const height = (await stage.boundingBox())!.height;
  expect(height).toBeGreaterThan(768 * .84);
  async function expectCanvasFillsViewport() {
    // WebGL starts with the browser's 300×150 canvas until ResizeObserver runs.
    // Wait for real canvas dimensions, not just visibility of its wrapper.
    await expect.poll(async () => {
      const viewport = (await stage.boundingBox())!;
      const canvas = (await stage.locator('canvas').boundingBox())!;
      return Math.max(Math.abs(canvas.height - height), Math.abs(canvas.width - viewport.width));
    }).toBeLessThanOrEqual(1);
    await expect(stage.locator('canvas')).toBeInViewport({ ratio: 1 });
  }
  await expectCanvasFillsViewport();
  await page.locator('.lighting-panel > summary').click();
  await expect(page.getByLabel('Frontlicht (%)')).toBeVisible();
  await expectCanvasFillsViewport();
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
  await expect(page.getByLabel('Hohe Renderqualität')).toBeVisible();
  await expect(page.locator('.lighting-panel')).toBeHidden();
  await expectCanvasFillsViewport();
  await page.getByRole('button', { name: '2D + 3D', exact: true }).click();
  await expectCanvasFillsViewport();
  await page.getByRole('button', { name: 'Licht', exact: true }).click();
  await expect(page.getByLabel('Frontlicht (%)')).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-dock-split.png' });
  await page.getByRole('button', { name: 'Seitenleiste schließen' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '2D + 3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.editor-dock')).toBeHidden();
  expect(errors).toEqual([]);
});

test('venue uses the same menus and dock in normal, fullscreen and narrow layouts', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Venue shell', venueName: 'Shared venue', sceneName: 'Shared stage' });
  await menu(page, 'Datei').click();
  await page.getByRole('button', { name: 'Spielstätte bearbeiten', exact: true }).click();
  await expect(page.locator('.editor-menubar')).toHaveCount(1);
  await expect(page.locator('.venue-document-heading')).toBeVisible();
  const canvas = page.getByRole('img', { name: 'Umriss der Spielstätte', exact: true });
  await expect(canvas).toBeVisible();
  await expect(page.locator('.editor-dock')).toBeHidden();
  expect((await canvas.boundingBox())!.height).toBeGreaterThan(768 * .84);
  await page.getByRole('button', { name: 'Eigenschaften', exact: true }).click();
  await expect(page.locator('.wall-inspector')).toBeVisible();
  await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
  await expect(page.locator('.wall-inspector')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Wandtyp anlegen' })).toBeVisible();
  await page.getByRole('button', { name: 'Vollbild', exact: true }).click();
  await expect(page.locator('.editor-local-menubar')).toBeVisible();
  await menu(page, 'Datei').click();
  await expect(page.getByRole('button', { name: 'Entwurf herunterladen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Vollbild', exact: true }).click();
  await expect(page.locator('#editor-menu-slot nav')).toBeVisible();
  for (const [width, height] of [[1024, 768], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: 'Seitenleiste schließen' })).toBeInViewport();
    await page.getByRole('button', { name: 'Seitenleiste schließen' }).click();
    await expect(canvas).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Traversen', exact: true })).toBeInViewport();
    await page.screenshot({ path: `test-results/editor-dock-venue-${width}.png` });
  }
});
