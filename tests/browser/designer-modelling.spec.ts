import { test, expect, type Page } from '@playwright/test';
import { signInToPlans } from '../helpers/plans.js';

type Point = { id: string; x: number; y: number };

async function openDesigner(page: Page) {
  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Bühnentechnik/ }).click();
  await expect(page.getByTestId('designer-page')).toBeVisible();
}

const preview = (page: Page) => page.getByTestId('designer-preview');

/** Screen position of a reference point or handle: the canvas readout is relative to the canvas. */
async function point(page: Page, match: (id: string) => boolean): Promise<Point> {
  const canvas = page.locator('.model-canvas canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  let found: Point | undefined;
  await expect.poll(async () => {
    const points = JSON.parse(await preview(page).getAttribute('data-handles') ?? '[]') as Point[];
    found = points.find(item => match(item.id));
    return !!found;
  }).toBe(true);
  return { id: found!.id, x: box.x + found!.x, y: box.y + found!.y };
}

/** Same as point(), but clamped into the WebGL canvas so a tall shell crop cannot miss the pick. */
async function pointOnCanvas(page: Page, match: (id: string) => boolean): Promise<Point> {
  const canvas = page.locator('.model-canvas canvas');
  const box = (await canvas.boundingBox())!;
  const raw = await point(page, match);
  const pad = 12;
  return {
    id: raw.id,
    x: Math.min(Math.max(raw.x, box.x + pad), box.x + box.width - pad),
    y: Math.min(Math.max(raw.y, box.y + pad), box.y + box.height - pad),
  };
}

/** Size of the selected solids in mm: [x, y, z] extents and the bottom. */
async function selectedSize(page: Page) {
  const text = await preview(page).getAttribute('data-selected-bounds');
  if (!text) return undefined;
  const [minX, minY, minZ, maxX, maxY, maxZ] = text.split(',').map(Number) as [number, number, number, number, number, number];
  return { x: Math.round(maxX - minX), y: Math.round(maxY - minY), z: Math.round(maxZ - minZ), bottom: Math.round(minY) };
}

const height = async (page: Page) => (await selectedSize(page))?.y;

test('designer models a box directly, ties its height to a per-variant option and saves it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  await openDesigner(page);

  await page.getByTestId('designer-library').getByRole('button', { name: 'Neu', exact: true }).click();
  await expect(page.getByTestId('designer-title')).toHaveText('Neues Bauteil');
  await page.getByTestId('part-name').fill('Kiste direkt modelliert');

  await test.step('clear the starting table', async () => {
    await page.getByTestId('designer-tab-outline').click();
    const outline = page.getByTestId('designer-section-outline');
    await outline.getByRole('button', { name: 'Platte entfernen' }).click();
    await outline.getByRole('button', { name: 'Bein entfernen' }).click();
    await expect(preview(page)).toHaveAttribute('data-solids', '0');
  });

  await test.step('draw a rectangle from the origin and type its size', async () => {
    await page.locator('body').press('r');
    await expect(preview(page)).toHaveAttribute('data-tool', 'rect');
    const origin = await pointOnCanvas(page, id => id === 'origin');
    const corner = await pointOnCanvas(page, id => id === 'ground-xz');
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.click(origin.x, origin.y);
    await page.mouse.move(corner.x, corner.y, { steps: 6 });
    await page.mouse.click(corner.x, corner.y);
    await expect(preview(page)).toHaveAttribute('data-solids', '1');
    await page.keyboard.type('1200;600');
    await expect(page.getByTestId('designer-value-box')).toHaveValue('1200;600');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('designer-value-box')).not.toBeFocused();
    await expect.poll(async () => {
      const size = await selectedSize(page);
      return size && [size.x, size.z].sort((a, b) => a - b).join('x') + `/${size.y}`;
    }).toBe('600x1200/12');
  });

  await test.step('pull the top up and type the exact height', async () => {
    await page.locator('body').press('p');
    await expect(preview(page)).toHaveAttribute('data-tool', 'pushpull');
    const top = await point(page, id => id.endsWith(':side:front'));
    await page.mouse.move(top.x, top.y);
    await page.mouse.click(top.x, top.y);
    await page.mouse.move(top.x, top.y - 80, { steps: 8 });
    await page.mouse.click(top.x, top.y - 80);
    await expect.poll(() => height(page)).toBeGreaterThan(12);
    await page.keyboard.type('750');
    await page.keyboard.press('Enter');
    await expect.poll(() => height(page)).toBe(750);
    expect((await selectedSize(page))?.bottom).toBe(0);
  });

  await test.step('undo and redo the pull as one step', async () => {
    await page.locator('body').press('Control+z');
    await expect.poll(() => height(page)).toBe(12);
    await page.locator('body').press('Control+Shift+z');
    await expect.poll(() => height(page)).toBe(750);
  });

  await test.step('turn the height into an option', async () => {
    await page.locator('body').press(' ');
    await expect(preview(page)).toHaveAttribute('data-tool', 'select');
    await page.getByTestId('designer-dimension-side:front').click();
    await expect(page.getByTestId('attribute-promote-callout')).toContainText('750');
    await page.getByTestId('attribute-promote').click();
    await expect(page.getByTestId('parameter-default-hoehe')).toHaveValue('750');
    await page.getByTestId('parameter-default-hoehe').fill('600');
    await expect.poll(() => height(page)).toBe(600);
    expect((await selectedSize(page))?.bottom).toBe(0);
    await page.getByTestId('parameter-default-hoehe').fill('750');
    await expect.poll(() => height(page)).toBe(750);
  });

  await test.step('let each variant set the height', async () => {
    await page.getByTestId('option-scope-hoehe').selectOption('variant');
    await page.getByTestId('designer-variant-add').click();
    await page.getByTestId('designer-variant-add').click();
    await expect(page.getByTestId('designer-variant-variante-2')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('parameter-default-hoehe').fill('900');
    await expect.poll(() => height(page)).toBe(900);
    await page.getByTestId('designer-variant-variante').click();
    await expect(page.getByTestId('parameter-default-hoehe')).toHaveValue('750');
    await expect.poll(() => height(page)).toBe(750);
  });

  await test.step('save and reload', async () => {
    await expect(page.getByTestId('designer-save')).toBeEnabled();
    await page.getByTestId('designer-save').click();
    await expect(page).toHaveURL(/#\/designer\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('designer-status')).toContainText('Revision 1');
    await page.reload();
    await expect(page.getByTestId('designer-title')).toHaveText('Kiste direkt modelliert');
    await expect(preview(page)).toHaveAttribute('data-solids', '1');
    await expect.poll(() => height(page)).toBe(750);
    await page.getByTestId('designer-variant-variante-2').click();
    await expect.poll(() => height(page)).toBe(900);
  });

  expect(errors).toEqual([]);
});

test('designer draws a circle face with the Kreis tool and typed radius', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  await openDesigner(page);
  await page.getByTestId('designer-library').getByRole('button', { name: 'Neu', exact: true }).click();
  await page.getByTestId('designer-tab-outline').click();
  const outline = page.getByTestId('designer-section-outline');
  await outline.getByRole('button', { name: 'Platte entfernen' }).click();
  await outline.getByRole('button', { name: 'Bein entfernen' }).click();
  await expect(preview(page)).toHaveAttribute('data-solids', '0');

  await page.locator('body').press('c');
  await expect(preview(page)).toHaveAttribute('data-tool', 'circle');
  await expect(page.getByTestId('designer-tool-circle')).toHaveAttribute('aria-pressed', 'true');
  const origin = await pointOnCanvas(page, id => id === 'origin');
  const rim = await pointOnCanvas(page, id => id === 'ground-x');
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.move(rim.x, rim.y, { steps: 6 });
  await page.mouse.click(rim.x, rim.y);
  await expect(preview(page)).toHaveAttribute('data-solids', '1');
  await page.keyboard.type('400');
  await page.keyboard.press('Enter');
  await expect.poll(async () => {
    const size = await selectedSize(page);
    return size && [size.x, size.z].sort((a, b) => a - b).join('x');
  }).toBe('800x800');

  expect(errors).toEqual([]);
});

test('designer groups a body into a sub-part, edits it in place and explodes it again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  await openDesigner(page);
  await page.getByTestId('designer-starters').getByRole('button', { name: 'Tisch als Kopie anlegen' }).click();
  await expect(page.getByTestId('designer-title')).toHaveText(/^Tisch Kopie/);
  await expect(preview(page)).toHaveAttribute('data-solids', '5');
  const before = await preview(page).getAttribute('data-bounds');

  await test.step('make the selected top a sub-part', async () => {
    await page.getByTestId('designer-tab-outline').click();
    await page.getByTestId('designer-make-child').click();
    await expect(page.getByTestId('designer-model-status')).toContainText('als Revision 1 angelegt');
    await expect(preview(page)).toHaveAttribute('data-solids', '5');
    await expect(preview(page)).toHaveAttribute('data-bounds', before!);
    await page.getByTestId('designer-tab-issues').click();
    await expect(page.getByTestId('designer-issues')).toContainText('Keine Fehler');
  });

  await test.step('edit the sub-part in place and save it as a new revision', async () => {
    await page.getByTestId('designer-enter-child').click();
    await expect(page.getByTestId('designer-inplace')).toBeVisible();
    await expect(preview(page)).toHaveAttribute('data-solids', '1');
    await expect(page.getByTestId('designer-save')).toBeDisabled();
    await page.getByTestId('designer-tab-options').click();
    await page.getByTestId('part-name').fill('Tischplatte');
    await page.getByTestId('designer-leave-child').click();
    await expect(page.getByTestId('designer-inplace')).toHaveCount(0);
    await expect(page.getByTestId('designer-model-status')).toContainText('als Revision 2 gespeichert');
    await expect(preview(page)).toHaveAttribute('data-solids', '5');
  });

  await test.step('explode the sub-part back into bodies and save', async () => {
    await page.getByTestId('designer-tab-outline').click();
    await page.getByTestId('designer-explode-child').click();
    await expect(page.getByTestId('designer-model-status')).toContainText('aufgelöst');
    await expect(preview(page)).toHaveAttribute('data-solids', '5');
    await expect(preview(page)).toHaveAttribute('data-bounds', before!);
    await page.getByTestId('designer-tab-issues').click();
    await expect(page.getByTestId('designer-issues')).toContainText('Keine Fehler');
    await page.getByTestId('designer-save').click();
    await expect(page.getByTestId('designer-status')).toContainText('Gespeichert als Revision 2');
  });

  expect(errors).toEqual([]);
});
