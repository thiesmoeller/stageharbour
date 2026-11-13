import { expect, test, type Page } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { placeNamedObjectAt, placeWallAt, showProperties } from '../helpers/inspector.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test.use({ viewport: { width: 1800, height: 1100 } });

async function create(page: Page, name: string) {
  await signInToPlans(page);
  await createProduction(page, { productionName: name, venueName: 'Interaktionssaal', sceneName: name });
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

test('hinge-edge connector snapping creates a joint and Alt bypasses snapping', async ({ page }) => {
  await create(page, 'Verbinder');
  await placeWallAt(page, 2000, 2500);
  await placeWallAt(page, 4000, 2500);
  await drag(page, await point(page, 4000, 2500), await point(page, 3180, 2500));
  await showProperties(page);
  await expect(page.getByLabel('X (mm)')).toHaveValue('3200');
  await page.mouse.click((await point(page, 7000, 5000)).x, (await point(page, 7000, 5000)).y);
  await expect(page.getByText('2 Bauteile · 1 Verbindungen')).toBeVisible();

  await page.locator('[data-testid^="object-"]').nth(1).locator('polygon').click();
  await page.keyboard.down('Alt');
  await drag(page, await point(page, 3200, 2500), await point(page, 3240, 2500));
  await page.keyboard.up('Alt');
  expect(Number(await page.getByLabel('X (mm)').inputValue())).toBeCloseTo(3240, 2);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
});

test('rubber-band selection spans every part kind and delete is one undo step', async ({ page }) => {
  await create(page, 'Mehrfachauswahl');
  await placeWallAt(page, 1800, 1800);
  await placeNamedObjectAt(page, 'Stütze hinzufügen', 3000, 2500);
  await placeNamedObjectAt(page, 'Kiste hinzufügen', 4500, 3000);
  await placeNamedObjectAt(page, 'Podest hinzufügen', 6000, 4000);
  await drag(page, await point(page, 500, 500), await point(page, 7500, 5500));
  await expect(page.getByTestId('selection-count')).toHaveText('4 ausgewählt');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(0);
  await revealEditorCommand(page, 'Rückgängig');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(4);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
});

test('placement is exclusive and Escape returns to selection without writing', async ({ page }) => {
  await create(page, 'Werkzeuge');
  const wall = page.getByRole('button', { name: 'Wandelement · Glattwand einsetzen', exact: true });
  const box = page.getByRole('button', { name: 'Kiste einsetzen', exact: true });
  await wall.click();
  await expect(page.locator('.plan-placement-hint')).toContainText('Wandelement');
  await box.click();
  await expect(page.locator('.plan-placement-hint')).toContainText('Kiste');
  await page.keyboard.press('Escape');
  await expect(page.locator('.plan-placement-hint')).toHaveCount(0);
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(0);
});
