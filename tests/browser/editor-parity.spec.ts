import { expect, test, type Page } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { placeNamedObjectAt, placeWallAt, showProperties } from '../helpers/inspector.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

// Guards the scene-editor behaviour that the layout v2 rewrite dropped: quick view switching,
// snapping with a visible toggle, rotation handles, 3D move/rotate tools and the light entry.
test.use({ viewport: { width: 1800, height: 1100 } });

async function create(page: Page, name: string) {
  await signInToPlans(page);
  await createProduction(page, { productionName: name, venueName: 'Paritätssaal', sceneName: name });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
}

async function point(page: Page, x: number, y: number) {
  const svg = page.locator('.plan-canvas > svg');
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate((element, p) => {
    const result = new DOMPoint(p.x, -p.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: result.x, y: result.y };
  }, { x, y });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function centre(page: Page, testId: string | RegExp) {
  const box = (await page.getByTestId(testId).locator('circle').first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('the view bar switches Grundriss, Raumsicht and Geteilt with one click', async ({ page }) => {
  await create(page, 'Ansichtsleiste');
  const bar = page.getByRole('toolbar', { name: 'Ansichten' });
  const plan = bar.getByRole('button', { name: 'Grundriss', exact: true });
  const stage = bar.getByRole('button', { name: 'Raumsicht', exact: true });
  const split = bar.getByRole('button', { name: 'Geteilt', exact: true });
  await expect(plan).toHaveAttribute('aria-pressed', 'true');
  await split.click();
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.plan-canvas > svg')).toBeVisible();
  await expect(page.locator('.stage-view')).toBeVisible();

  await stage.click();
  await expect(stage).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.plan-canvas')).toHaveCount(0);
  await expect(page.locator('.stage-view')).toBeVisible();

  await plan.click();
  await expect(plan).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.plan-canvas > svg')).toBeVisible();
  await expect(page.locator('.stage-view')).toHaveCount(0);

  // The choice survives a reload.
  await page.reload();
  await expect(page.getByRole('toolbar', { name: 'Ansichten' }).getByRole('button', { name: 'Grundriss', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('toolbar', { name: 'Ansichten' }).getByRole('button', { name: 'Vollbild', exact: true })).toBeVisible();
});

test('undo, redo and the scene title are directly visible in the header', async ({ page }) => {
  await create(page, 'Kopfzeile mit langem Namen');
  const header = page.locator('.editor-toolbar');
  const undo = header.locator('.document-history').getByRole('button', { name: 'Rückgängig', exact: true });
  const redo = header.locator('.document-history').getByRole('button', { name: 'Wiederholen', exact: true });
  await expect(undo).toBeDisabled();
  await placeWallAt(page, 3000, 2500);
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(1);
  await undo.click();
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(0);
  await redo.click();
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(1);

  // The title is not cut off by the header row.
  const heading = header.getByRole('heading');
  const clipped = await heading.evaluate(element => {
    const own = element.getBoundingClientRect(), bar = element.closest('header')!.getBoundingClientRect();
    return own.top < bar.top - 0.5 || own.bottom > bar.bottom + 0.5;
  });
  expect(clipped).toBe(false);
});

test('walls line up while dragging; the Einrasten switch and Alt turn that off', async ({ page }) => {
  await create(page, 'Einrasten');
  await placeWallAt(page, 2000, 2500);
  await placeWallAt(page, 5000, 3500);
  const toggle = page.getByRole('checkbox', { name: 'Einrasten' });
  await expect(toggle).toBeChecked();

  // 10 mm off the first wall's line and far from its hinge edge: the faces align.
  const from = await point(page, 5000, 3500), to = await point(page, 4800, 2510);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.getByTestId('alignment-guides')).toBeVisible();
  await expect(page.locator('.status-hint')).toContainText('Eingerastet');
  await page.mouse.up();
  await expect(page.getByTestId('alignment-guides')).toHaveCount(0);
  await showProperties(page);
  await expect(page.getByLabel('Y (mm)')).toHaveValue('2500');
  // Lining up edges is not a connection: no joint is created.
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 Bauteile · 0 Verbindungen')).toBeVisible();

  await toggle.uncheck();
  await drag(page, await point(page, 4800, 2500), await point(page, 4800, 2530));
  expect(Number(await page.getByLabel('Y (mm)').inputValue())).toBeCloseTo(2530, 0);

  // The switch is remembered for this scene view.
  await toggle.check();
  await drag(page, await point(page, 4800, 2530), await point(page, 4800, 2508));
  await expect(page.getByLabel('Y (mm)')).toHaveValue('2500');
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
});

test('the orange handle rotates one object in 15° steps and Escape cancels', async ({ page }) => {
  await create(page, 'Drehen');
  await placeWallAt(page, 4000, 3000);
  await showProperties(page);
  const handle = /^rotate-[0-9a-f-]{36}$/;
  await expect(page.getByTestId(handle)).toBeVisible();

  // Pull the handle towards 88°: it settles on 90°.
  const target = await point(page, 4000 + Math.cos(88 * Math.PI / 180) * 1500, 3000 + Math.sin(88 * Math.PI / 180) * 1500);
  await drag(page, await centre(page, handle), target);
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('90');

  // Escape during a rotation restores the angle and keeps the selection.
  const start = await centre(page, handle), away = await point(page, 2500, 3000);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(away.x, away.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('90');
  await expect(page.getByTestId(handle)).toBeVisible();

  // One undo step per rotation.
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('0');
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
});

test('a multi-selection moves and rotates as one and Escape cancels the whole move', async ({ page }) => {
  await create(page, 'Mehrfachdrehen');
  await placeWallAt(page, 2500, 2000);
  await placeNamedObjectAt(page, 'Kiste hinzufügen', 4500, 3500);
  await drag(page, await point(page, 500, 500), await point(page, 7500, 5500));
  await expect(page.getByTestId('selection-count')).toHaveText('2 ausgewählt');
  await expect(page.getByTestId('rotate-selection')).toBeVisible();
  const wall = page.locator('[data-testid^="object-"]').first();
  const before = await wall.locator('polygon').first().getAttribute('points');

  const a = await point(page, 2500, 2000), b = await point(page, 2900, 2400);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await expect(wall.locator('polygon').first()).not.toHaveAttribute('points', before!);
  await page.keyboard.press('Delete'); // Commands wait until the gesture ends.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(wall.locator('polygon').first()).toHaveAttribute('points', before!);
  await expect(page.getByTestId('selection-count')).toHaveText('2 ausgewählt');
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(2);

  const pivot = { x: 3500, y: 2750 };
  await drag(page, await centre(page, 'rotate-selection'), await point(page, pivot.x, pivot.y + 1500));
  await expect(wall.locator('polygon').first()).not.toHaveAttribute('points', before!);
  await expect(page.getByTestId('selection-count')).toHaveText('2 ausgewählt');
  await page.keyboard.press('Control+z');
  await expect(wall.locator('polygon').first()).toHaveAttribute('points', before!);
});

test('the plan has zoom controls and fits back to the whole stage', async ({ page }) => {
  await create(page, 'Zoom');
  const zoom = page.locator('.plan-zoom');
  await expect(zoom).toContainText('100 %');
  await zoom.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  await expect(zoom).not.toContainText('100 %');
  await page.getByRole('button', { name: 'Passend', exact: true }).click();
  await expect(zoom).toContainText('100 %');
});

test('the tool rail groups parts by category instead of listing every size', async ({ page }) => {
  await create(page, 'Werkzeugleiste');
  const rail = page.getByRole('toolbar', { name: 'Werkzeuge' });
  await expect(rail.getByRole('button', { name: 'Auswahl', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await rail.getByRole('button').count()).toBeLessThan(20);

  // Every other size and part sits one click away in the category's list.
  await rail.getByRole('button', { name: 'Wände: weitere Bauteile', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Wände' });
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: 'Tür', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(page.locator('.plan-placement-hint')).toContainText('Tür');
  await expect(rail.getByRole('button', { name: 'Auswahl', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  // The category remembers what was used last.
  await expect(rail.getByRole('button', { name: 'Tür einsetzen', exact: true })).toBeVisible();
});

test('the room view offers move and rotate handles for the selection', async ({ page }) => {
  await create(page, 'Raumgriffe');
  await placeWallAt(page, 4000, 3000);
  await page.getByRole('toolbar', { name: 'Ansichten' }).getByRole('button', { name: 'Raumsicht', exact: true }).click();
  const select = page.getByRole('button', { name: '3D auswählen', exact: true });
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['3D verschieben', '3D drehen']) {
    const tool = page.getByRole('button', { name, exact: true });
    await tool.click();
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(select).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('button', { name: 'Auswahl einpassen', exact: true })).toBeEnabled();
});

test('light and display settings are reachable from the Ansicht menu', async ({ page }) => {
  await create(page, 'Lichtmenü');
  await revealEditorCommand(page, 'Licht einstellen');
  await page.getByRole('button', { name: 'Licht einstellen', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Licht', exact: true })).toBeVisible();
  await revealEditorCommand(page, 'Anzeige einstellen');
  await page.getByRole('button', { name: 'Anzeige einstellen', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Anzeige', exact: true })).toBeVisible();
  await revealEditorCommand(page, 'Bedienung anzeigen');
  await page.getByRole('button', { name: 'Bedienung anzeigen', exact: true }).click();
  await expect(page.locator('.workspace-help')).toContainText('Einrasten');
});
