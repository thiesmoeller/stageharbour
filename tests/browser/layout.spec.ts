import { expect, test, type Page } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { commitObjectPlacement, placeNamedObjectAt, placeWallAt, showProperties } from '../helpers/inspector.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

async function create(page: Page, name: string) {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: `Layout v2 ${name}`,
    venueName: 'Bauteilsaal',
    sceneName: name,
  });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
}

async function openCommand(page: Page, name: string) {
  await revealEditorCommand(page, name);
  return page.getByRole('button', { name, exact: true });
}

test('starter parts insert, inspect, render and persist through the generic object path', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await create(page, 'Bauteilreise');

  await placeWallAt(page, 2000, 2500);
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Bauteil', exact: true })).toBeVisible();
  await page.getByLabel('Variante').selectOption('doorLeft');
  await page.getByLabel('Bezeichnung').fill('Portalwand');
  await page.getByLabel('Türöffnung').fill('40');
  await page.getByText('Oberflächen', { exact: true }).click();
  await page.getByLabel('part-finish-front-full Art').selectOption('paint');
  await page.getByRole('option', { name: /RAL 3020/ }).click();
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('[data-testid^="object-"][aria-label="Portalwand"]')).toBeVisible();

  await placeNamedObjectAt(page, 'Stütze hinzufügen', 2000, 2850);
  await page.getByLabel('Betonplatten').selectOption('2');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await placeNamedObjectAt(page, 'Podest hinzufügen', 5000, 3500);
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(3);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');

  await (await openCommand(page, 'Raumsicht')).click();
  await expect(page.getByTestId('stage-view')).toBeVisible();
  await expect(page.locator('[data-testid^="stage-object-"]')).toHaveCount(3);
  await expect(page.locator('.stage-view canvas')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bauteilreise', exact: true })).toBeVisible();
  // The chosen view is remembered across reloads; the plan is one click away in the view bar.
  await (await openCommand(page, 'Grundriss')).click();
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(3);
  await page.locator('[data-testid^="object-"][aria-label="Portalwand"]').locator('polygon').first().click();
  await showProperties(page);
  await expect(page.getByLabel('Variante')).toHaveValue('doorLeft');
  await expect(page.getByLabel('Türöffnung')).toHaveValue('40');
  await page.getByText('Oberflächen', { exact: true }).click();
  await expect(page.getByRole('option', { name: /RAL 3020/ })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('generic objects support multi-selection, groups, clipboard and undo', async ({ page }) => {
  await create(page, 'Objektaktionen');
  await placeWallAt(page, 2000, 2500);
  await placeWallAt(page, 5000, 2500);
  const objects = page.locator('[data-testid^="object-"]');
  await expect(objects).toHaveCount(2);
  await objects.nth(0).locator('polygon').click();
  await objects.nth(1).locator('polygon').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('selection-count')).toHaveText('2 ausgewählt');

  const group = await openCommand(page, 'Gruppieren');
  await expect(group).toBeEnabled();
  await group.click();
  await showProperties(page);
  await expect(page.getByRole('heading', { name: 'Gruppe', exact: true })).toBeVisible();
  await page.getByLabel('Drehpunkt X (mm)').fill('3800');
  await page.getByLabel('Gruppendrehung (°)').fill('30');
  await page.locator('.group-panel').getByRole('button', { name: 'Übernehmen' }).click();

  await page.keyboard.press('Control+c');
  const paste = await openCommand(page, 'Einfügen');
  await expect(paste).toBeEnabled();
  await paste.click();
  // The copy follows the pointer until the plan is clicked.
  await expect(page.locator('.plan-placement-hint')).toContainText('Platzieren');
  await expect(objects).toHaveCount(4);
  const ghost = objects.nth(2).locator('polygon');
  const before = await ghost.getAttribute('points');
  const hovered = await page.locator('.plan-canvas > svg').evaluate((element, point) => {
    const mapped = new DOMPoint(point.x, -point.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: mapped.x, y: mapped.y };
  }, { x: 6500, y: 4200 });
  await page.mouse.move(hovered.x, hovered.y);
  await expect.poll(async () => ghost.getAttribute('points')).not.toBe(before);
  await commitObjectPlacement(page, 6500, 4200);
  await expect(objects).toHaveCount(4);
  await (await openCommand(page, 'Rückgängig')).click();
  await expect(objects).toHaveCount(2);
  await (await openCommand(page, 'Wiederholen')).click();
  await expect(objects).toHaveCount(4);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
});

test('catalog library inserts a non-starter favourite path through the same placement seam', async ({ page }) => {
  await create(page, 'Katalogeinsatz');
  const library = page.getByRole('button', { name: 'Bibliothek', exact: true });
  await library.click();
  const panel = page.locator('.part-library');
  await expect(panel).toContainText('Wandelement');
  const table = panel.locator('.library-row').filter({ has: page.getByText('Tisch', { exact: true }) });
  await table.getByRole('button', { name: 'Einsetzen' }).click();
  await commitObjectPlacement(page, 3500, 3000);
  await expect(page.locator('[data-testid^="object-"][aria-label="Tisch"]')).toBeVisible();
});
