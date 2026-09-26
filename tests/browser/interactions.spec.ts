import { commitObjectPlacement, openInspector, placeNamedObjectAt, placeWallAt } from '../helpers/inspector.js';
import { test, expect, type Page } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test.use({ viewport: { width: 1800, height: 1100 } });

async function create(page: Page) {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: `Interaktionen ${test.info().testId}`,
    venueName: 'Probesaal',
  });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
}
async function point(page: Page, x: number, y: number, selector = '.plan-canvas > svg') {
  await page.locator(selector).scrollIntoViewIfNeeded();
  return page.locator(selector).evaluate((element, p) => {
    const result = new DOMPoint(p.x, -p.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: result.x, y: result.y };
  }, { x, y });
}
async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
}

test('wall edge snapping, pointer rotation, clipboard, mixed marquee delete and undo', async ({ page }) => {
  await create(page);
  await placeWallAt(page, 2000, 2500);
  await page.locator('#wall-x').fill('2000'); await page.locator('#wall-y').fill('2500');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await placeWallAt(page);
  await drag(page, await point(page, 4000, 3000), await point(page, 3160, 2500));
  await expect(page.locator('#wall-x')).toHaveValue('3200');
  await page.keyboard.down('Alt');
  await drag(page, await point(page, 3200, 2500), await point(page, 3240, 2500));
  await page.keyboard.up('Alt');
  await expect(page.locator('#wall-x')).toHaveValue('3240');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('#wall-x')).toHaveValue('3200');
  const selected = await page.locator('#wall-selection').inputValue();
  const handle = page.getByTestId(`rotate-${selected.replace('wall:', '')}`).locator('circle').first();
  const box = (await handle.boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, await point(page, 3200, 3500));
  await expect(page.locator('#wall-rotation')).toHaveValue('90');
  await page.getByRole('button', { name: 'Kopieren', exact: true }).click();
  await page.keyboard.press('Control+v');
  await commitObjectPlacement(page);
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(3);
  await placeNamedObjectAt(page, 'Stütze hinzufügen');
  await placeNamedObjectAt(page, 'Kiste hinzufügen');
  await drag(page, await point(page, 700, 800), await point(page, 6500, 5500));
  await expect(page.getByTestId('selection-count')).toContainText('5 ausgewählt');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="brace-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(3);
  await expect(page.locator('[data-testid^="brace-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(1);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
});

test('scene 2D marquee can start outside the venue outline', async ({ page }) => {
  await create(page);
  await placeWallAt(page, 2000, 2500);
  await placeWallAt(page, 5000, 4000);
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(2);
  // Start in the padded margin outside the outline fill, then drag across both walls.
  await drag(page, await point(page, -400, 1000), await point(page, 7000, 5500));
  await expect(page.getByTestId('selection-count')).toContainText('2 ausgewählt');
});

test('venue vertex gestures have preview, cancel, one undo and publish semantics', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: 'Spielstätte', exact: true }).click();
  const svg = 'svg[aria-label="Umriss der Spielstätte"]';
  const start = await point(page, 0, 0, svg), end = await point(page, 300, 300, svg);
  await drag(page, start, end);
  await expect(page.locator('#vertex-x-0')).toHaveValue('300');
  await page.getByRole('button', { name: 'Spielstätte rückgängig' }).click();
  await expect(page.locator('#vertex-x-0')).toHaveValue('0');
  await page.getByRole('button', { name: 'Spielstätte wiederholen' }).click();
  await expect(page.locator('#vertex-x-0')).toHaveValue('300');
  await expect(page.locator('[data-renderer="pascal"] canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Spielstätte speichern', exact: true }).click();
  await expect(page.getByText('Spielstättenfassung gespeichert', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Spielstätte schließen' }).click();
  await expect(page.getByTestId('venue-floor')).toHaveAttribute('d', /^M300 -300/);
});

test('venue plan drag, rubberband clipboard and escape cancel keep one draft history', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: 'Spielstätte', exact: true }).click();
  await openInspector(page, 'Zwischenablage');
  const svg = 'svg[aria-label="Umriss der Spielstätte"]';
  await page.getByRole('button', { name: 'Feste Wand setzen' }).click();
  await page.mouse.click((await point(page, 3400, 3000, svg)).x, (await point(page, 3400, 3000, svg)).y);
  const end = await point(page, 4600, 3000, svg);
  await page.mouse.move(end.x, end.y);
  await expect(page.getByTestId('venue-wall-draw-preview')).toBeVisible();
  await page.mouse.click(end.x, end.y);
  const wallX = page.getByLabel('Feste Wand 1 x');
  await expect(wallX).toHaveValue('4000');
  await expect(page.getByLabel('Feste Wand 1 width')).toHaveValue('1200');
  await drag(page, await point(page, 4000, 3000, svg), await point(page, 4500, 3200, svg));
  await expect(wallX).toHaveValue('4500');
  await expect(page.getByLabel('Feste Wand 1 y')).toHaveValue('3200');
  // Rubber band selects only fully enclosed footprints (wall ~3900–5100 after move × thickness).
  await page.getByRole('button', { name: 'Spielstätte rückgängig' }).click();
  await expect(wallX).toHaveValue('4000');
  // Rubber band selects only fully enclosed footprints (wall ~3400–4600 × 2986–3014).
  await drag(page, await point(page, 3200, 2800, svg), await point(page, 4800, 3200, svg));
  await expect(page.locator('.venue-editor .clipboard-panel')).toContainText('1 ausgewählt');
  await page.getByRole('button', { name: 'Kopieren' }).click();
  await page.getByRole('button', { name: 'Einfügen' }).click();
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveCount(2);
  await expect(page.locator(`${svg}.placing-cursor`)).toHaveCount(1);
  // Commit must work even when the click hits the floating paste (objects sit above place-target).
  const placeAt = await point(page, 5500, 4000, svg);
  await page.mouse.click(placeAt.x, placeAt.y);
  await expect(page.locator(`${svg}.placing-cursor`)).toHaveCount(0);
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Feste Wand 2' })).toBeVisible();
  // Linux middle-click orbit fires a native paste event; it must not stamp another copy.
  await page.evaluate(() => window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true })));
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('venue-selection-marquee')).toHaveCount(0);
});

test('venue wall types author openings on permanent walls', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: 'Spielstätte', exact: true }).click();
  const svg = 'svg[aria-label="Umriss der Spielstätte"]';
  await openInspector(page, 'Wandtypen / Öffnungen');
  await page.locator('.venue-editor').getByRole('button', { name: 'Wandtyp anlegen' }).click();
  await page.locator('.venue-editor').getByLabel('Wandtyp-Bezeichnung').fill('Türwand Spielstätte');
  await page.locator('.venue-editor').getByRole('button', { name: 'Türöffnung hinzufügen' }).click();
  await page.locator('.venue-editor').getByRole('button', { name: 'Wandtyp speichern' }).click();
  await page.locator('.venue-editor').getByRole('button', { name: 'Wandtyp platzieren' }).click();
  await page.mouse.click((await point(page, 4000, 3000, svg)).x, (await point(page, 4000, 3000, svg)).y);
  await page.mouse.click((await point(page, 5500, 3000, svg)).x, (await point(page, 5500, 3000, svg)).y);
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveCount(1);
  const opening = page.locator('[data-testid^="venue-plan-opening-"]');
  await expect(opening).toHaveCount(1);
  await expect(opening).toHaveAttribute('data-width', '800');
  await expect(opening).toHaveAttribute('data-height', '2000');
  await expect(opening).toHaveAttribute('data-hinge', 'left');
  await expect(page.getByLabel('Feste Wand 1 Wandtyp')).toHaveValue(/.+/);
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveAttribute('data-opening-count', '1');
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveAttribute('data-opening-width', '800');
});

test('venue inline cutout is drawn on a permanent wall without a wall type', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: 'Spielstätte', exact: true }).click();
  const svg = 'svg[aria-label="Umriss der Spielstätte"]';
  await page.getByRole('button', { name: 'Feste Wand setzen' }).click();
  await page.mouse.click((await point(page, 1500, 3000, svg)).x, (await point(page, 1500, 3000, svg)).y);
  await page.mouse.click((await point(page, 6500, 3000, svg)).x, (await point(page, 6500, 3000, svg)).y);
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveCount(1);
  await page.getByLabel('Feste Wand 1 width').fill('5000');
  await page.getByLabel('Feste Wand 1 height').fill('2989');
  await page.getByLabel('Feste Wand 1 thickness').fill('200');
  await page.getByLabel('Feste Wand 1 x').fill('4000');
  await page.getByLabel('Feste Wand 1 y').fill('3000');
  await page.getByRole('button', { name: 'Ausschnitt zeichnen', exact: true }).first().click();
  // Wall centre 4000,3000 width 5000 → span from 2500 to 4500 along X (along = 0…5000).
  const cutStart = await point(page, 2500, 3000, svg);
  await page.mouse.move(cutStart.x, cutStart.y);
  await expect(page.getByTestId('venue-opening-cut-guide')).toBeVisible();
  await drag(page, cutStart, await point(page, 4500, 3000, svg));
  const opening = page.locator('[data-testid^="venue-plan-opening-"]');
  await expect(opening).toHaveCount(1);
  await expect(opening).toHaveAttribute('data-width', '2000');
  await expect(opening).toHaveAttribute('data-sill', '0');
  await expect(opening).toHaveAttribute('data-hinge', '');
  const stageWall = page.locator('[data-testid^="stage-wall-"]');
  await expect(stageWall).toHaveAttribute('data-opening-count', '1');
  await expect(stageWall).toHaveAttribute('data-opening-width', '2000');

  // Delete cutout → plan gap gone, 3D wall solid again and still painted.
  await page.getByRole('button', { name: 'Ausschnitt entfernen' }).click();
  await expect(opening).toHaveCount(0);
  await expect(stageWall).toHaveAttribute('data-opening-count', '0');
  await page.getByRole('button', { name: 'Von oben', exact: true }).click();
  const canvas = page.locator('[data-renderer="pascal"] canvas');
  await canvas.scrollIntoViewIfNeeded();
  await expect(async () => {
    const png = await canvas.screenshot();
    const painted = await page.evaluate(async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      // Lit meshStandard plywood reads green-dominant; exact hex drifts under lights.
      let hits = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
        if (g > r + 15 && g > b + 10 && g > 40 && g < 180) hits++;
      }
      return hits;
    }, png.toString('base64'));
    expect(painted).toBeGreaterThan(200);
  }).toPass();

  // Re-draw after delete so the solid→cutout→solid→cutout cycle stays editable.
  await page.getByRole('button', { name: 'Ausschnitt zeichnen', exact: true }).first().click();
  await drag(page, await point(page, 2800, 3000, svg), await point(page, 4200, 3000, svg));
  await expect(page.locator('[data-testid^="venue-plan-opening-"]')).toHaveCount(1);
  await expect(stageWall).toHaveAttribute('data-opening-count', '1');
  await expect(stageWall).toHaveAttribute('data-opening-width', '1400');
});

test('venue pins, exits, podiums and chairs can be selected, moved and rotated', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: 'Spielstätte', exact: true }).click();
  const svg = 'svg[aria-label="Umriss der Spielstätte"]';
  const tools = page.locator('.venue-editor .tool-rail');
  async function clickPlan(x: number, y: number) {
    const p = await point(page, x, y, svg);
    await page.mouse.click(p.x, p.y);
  }
  await tools.getByRole('button', { name: 'Strom setzen' }).click();
  await clickPlan(4000, 3000);
  await expect(page.locator('[data-testid^="connection-point-"]')).toHaveCount(1);
  await drag(page, await point(page, 4000, 3000, svg), await point(page, 4200, 3100, svg));
  await expect(page.getByLabel('Strom X')).toHaveValue('4200');
  await tools.getByRole('button', { name: 'Freihaltezone zeichnen' }).click();
  await clickPlan(1000, 1000);
  await clickPlan(3000, 1000);
  await clickPlan(3000, 2500);
  await clickPlan(1050, 1050);
  await expect(page.locator('[data-testid^="keep-clear-zone-"]')).toHaveCount(1);
  await tools.getByRole('button', { name: 'Podest setzen' }).click();
  await clickPlan(5000, 4000);
  await expect(page.locator('[data-testid^="venue-platform-"]')).toHaveCount(1);
  await expect(page.getByTestId(/^rotate-venue-platform-/)).toBeVisible();
  await tools.getByRole('button', { name: 'Stuhl setzen' }).click();
  await clickPlan(2000, 1500);
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(1);
  await expect(page.getByTestId(/^rotate-venue-placeholder-/)).toBeVisible();
  await tools.getByRole('button', { name: 'Lüftungskanal setzen' }).click();
  await clickPlan(4500, 3500);
  await expect(page.locator('[data-testid^="overhead-box-"]')).toHaveCount(1);
  await expect(page.locator('#venue-ceiling-selected')).toHaveValue('4000');
});

test('rendered Pascal translation handle moves the shared plan and undoes once', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await create(page);
  await placeWallAt(page);
  await page.getByRole('button', { name: 'Von oben', exact: true }).click();
  const canvas = page.locator('[data-renderer="pascal"] canvas');
  await canvas.scrollIntoViewIfNeeded();
  let handle: { x: number; y: number } | undefined;
  await expect(async () => {
    const png = await canvas.screenshot();
    handle = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const points: { x: number; y: number }[] = [];
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        if (data[i]! > 150 && data[i]! > data[i + 1]! * 1.8 && data[i]! > data[i + 2]! * 1.8) points.push({ x, y });
      }
      return points.length ? points[Math.floor(points.length / 2)] : undefined;
    }, png.toString('base64'));
    expect(handle).toBeDefined();
  }).toPass();
  const bounds = (await canvas.boundingBox())!;
  const start = { x: bounds.x + handle!.x, y: bounds.y + handle!.y };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x - 60, start.y, { steps: 8 });
  await page.keyboard.press('Delete'); await page.keyboard.press('Control+z');
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('#wall-x')).not.toHaveValue('4000');
  const moved = await page.locator('#wall-x').inputValue();
  await expect(page.locator('[data-testid^="stage-wall-"]')).toHaveAttribute('data-x', moved);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('#wall-x')).toHaveValue('4000');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.locator('#wall-x')).toHaveValue(moved);
  expect(errors).toEqual([]);
});

test('Shift-deselect removes the object from every command target', async ({ page }) => {
  await create(page);
  await placeWallAt(page, 2000, 2500);
  const at = await point(page, 2000, 2500);
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
  await expect(page.getByRole('button', { name: 'Kopieren', exact: true })).toBeDisabled();
  await expect(page.locator('#wall-selection')).toHaveValue('');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(1);
});

test('mixed wall-platform selection moves from either object and cancels atomically', async ({ page }) => {
  await create(page);
  await placeWallAt(page, 1500, 1000);
  await placeNamedObjectAt(page, 'Podest hinzufügen');
  await drag(page, await point(page, 500, 500), await point(page, 6500, 5500));
  await expect(page.getByTestId('selection-count')).toContainText('2 ausgewählt');
  await expect(page.getByTestId('rotate-selection')).toBeVisible();
  const wall = page.locator('[data-testid^="wall-"]');
  const platform = page.locator('[data-testid^="platform-"] path');
  const before = await platform.getAttribute('d');
  await page.keyboard.down('Alt');
  await drag(page, await point(page, 4000, 3000), await point(page, 4300, 3200));
  await page.keyboard.up('Alt');
  await expect(wall).toHaveAttribute('transform', 'translate(1800 -1200) rotate(0)');
  await expect(platform).not.toHaveAttribute('d', before!);
  await expect(page.getByTestId('selection-count')).toContainText('2 ausgewählt');
  await page.keyboard.press('Control+z');
  await expect(wall).toHaveAttribute('transform', 'translate(1500 -1000) rotate(0)');
  await expect(platform).toHaveAttribute('d', before!);
  const a = await point(page, 1500, 1000), b = await point(page, 1800, 1400);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.keyboard.press('Delete'); // Command is blocked for the whole transaction.
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(wall).toHaveAttribute('transform', 'translate(1500 -1000) rotate(0)');
  await expect(platform).toHaveAttribute('d', before!);
  await expect(page.getByTestId('selection-count')).toContainText('2 ausgewählt');
});

test('venue Shift toggles without dragging; mixed rotation and cancel preserve selection', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: 'Spielstätte', exact: true }).click();
  await openInspector(page, 'Zwischenablage');
  const svg = 'svg[aria-label="Umriss der Spielstätte"]';
  await page.getByRole('button', { name: 'Feste Wand setzen' }).click();
  const a = await point(page, 3400, 3000, svg), b = await point(page, 4600, 3000, svg);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveAttribute('transform', 'translate(4000 -3000) rotate(0)');
  const wallAt = await point(page, 4000, 3000, svg);
  await page.keyboard.down('Shift');
  await drag(page, wallAt, await point(page, 4400, 3200, svg));
  await page.keyboard.up('Shift');
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveAttribute('transform', 'translate(4000 -3000) rotate(0)');
  await expect(page.getByRole('button', { name: 'Kopieren', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stuhl setzen' }).click();
  await page.mouse.click((await point(page, 5000, 4000, svg)).x, (await point(page, 5000, 4000, svg)).y);
  await drag(page, await point(page, 500, 500, svg), await point(page, 6500, 5500, svg));
  await expect(page.getByTestId('rotate-venue-selection')).toBeVisible();
  await expect(page.locator('.venue-editor .clipboard-panel')).toContainText('2 ausgewählt');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.keyboard.press('Backspace'); await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.venue-editor .clipboard-panel')).toContainText('2 ausgewählt');
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveAttribute('transform', 'translate(4000 -3000) rotate(0)');
});

test('scene face resizing previews, cancels, commits and undoes once', async ({ page }) => {
  await create(page);
  await placeNamedObjectAt(page, 'Kiste hinzufügen');
  const solid = page.locator('[data-testid^="stage-placeholder-"]');
  const dimensions = () => solid.evaluate(element => ['data-width', 'data-depth', 'data-height'].map(key => element.getAttribute(key)).join('/'));
  const initial = await dimensions();
  await page.getByRole('button', { name: 'Auswahl einpassen', exact: true }).click();
  await page.getByRole('button', { name: 'Größe ziehen', exact: true }).click();
  const canvas = page.locator('[data-renderer="pascal"] canvas');
  await canvas.scrollIntoViewIfNeeded();
  await canvas.screenshot();
  const bounds = (await canvas.boundingBox())!;
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(centre.x, centre.y); await page.mouse.down();
  await page.mouse.move(centre.x, centre.y - 55, { steps: 8 });
  await expect.poll(dimensions).not.toBe(initial);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(dimensions).toBe(initial);
  await expect(page.getByTestId('selection-count')).toContainText('1 ausgewählt');
  await drag(page, centre, { x: centre.x, y: centre.y - 55 });
  await expect.poll(dimensions).not.toBe(initial);
  await page.keyboard.press('Control+z');
  await expect.poll(dimensions).toBe(initial);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
});
