import { expect, test, type Page } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { placeWallAt, showProperties } from '../helpers/inspector.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test.use({ viewport: { width: 1600, height: 1000 } });

async function create(page: Page, name: string) {
  await signInToPlans(page);
  await createProduction(page, { productionName: `Werkzeuge ${name}`, venueName: 'Werkzeugsaal', sceneName: name });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
}

async function planPoint(page: Page, x: number, y: number) {
  const svg = page.locator('.plan-canvas > svg');
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate((element, p) => {
    const mapped = new DOMPoint(p.x, -p.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: mapped.x, y: mapped.y };
  }, { x, y });
}

async function clickPlan(page: Page, x: number, y: number) {
  const screen = await planPoint(page, x, y);
  await page.mouse.click(screen.x, screen.y);
}

test('places a Maß between two walls and undoes it', async ({ page }) => {
  await create(page, 'Maß');
  await placeWallAt(page, 2000, 2500);
  await placeWallAt(page, 5200, 2500);
  const walls = page.locator('[data-testid^="object-"] polygon');
  const corner = async (index: number) => {
    const points = (await walls.nth(index).getAttribute('points'))!;
    const [x, y] = points.trim().split(/\s+/)[0]!.split(',').map(Number);
    return { x: x!, y: -y! };
  };
  const first = await corner(0);
  const second = await corner(1);

  await page.getByRole('button', { name: 'Maß hinzufügen', exact: true }).click();
  await expect(page.locator('.status-hint')).toContainText('Ersten Punkt');
  await clickPlan(page, first.x, first.y);
  await clickPlan(page, second.x, second.y);
  await clickPlan(page, (first.x + second.x) / 2, Math.min(first.y, second.y) - 900);

  const line = page.locator('.dimension-layer .dimension-line');
  await expect(line).toHaveCount(1);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(line).toHaveCount(0);
  await expect(page.locator('[data-testid^="object-"]')).toHaveCount(2);
});

test('draws a three-point cable run and deletes the middle vertex', async ({ page }) => {
  await create(page, 'Kabel');
  await page.getByRole('button', { name: 'Kabel zeichnen', exact: true }).click();
  await clickPlan(page, 1200, 1600);
  await clickPlan(page, 3400, 1600);
  await clickPlan(page, 3400, 3600);
  await page.keyboard.press('Enter');

  const vertices = page.locator('[data-testid^="cable-run-vertex-"]');
  await expect(vertices).toHaveCount(3);
  await expect(page.getByTestId('selection-count')).toHaveText('1 Kabelweg ausgewählt');
  await vertices.nth(1).click();
  await expect(page.getByTestId('selection-count')).toHaveText('1 Zwischenpunkt ausgewählt');
  await page.keyboard.press('Delete');
  await expect(vertices).toHaveCount(2);
  await expect(page.locator('[data-testid="cable-runs"] path').first()).toBeVisible();
});

test('curtain and venue-door open percent are set from the scene inspector', async ({ page }) => {
  test.setTimeout(90_000);
  await create(page, 'Vorhang');
  await revealEditorCommand(page, 'Spielstätte bearbeiten');
  await page.getByRole('button', { name: 'Spielstätte bearbeiten', exact: true }).click();
  await page.getByRole('button', { name: 'Molton zeichnen', exact: true }).click();
  await clickPlan(page, 1000, 2800);
  await clickPlan(page, 7000, 2800);
  await expect(page.locator('[data-testid^="curtain-"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Feste Wand setzen', exact: true }).click();
  await clickPlan(page, 1000, 1800);
  await clickPlan(page, 5000, 1800);
  await expect(page.locator('[data-testid^="venue-wall-"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ausschnitt zeichnen', exact: true }).click();
  const start = await planPoint(page, 1800, 1800);
  const end = await planPoint(page, 3200, 1800);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await showProperties(page);
  await page.getByLabel(/Ausschnitt 1 hinge/).selectOption('left');

  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Spielstättenfassung gespeichert');
  await page.locator('.back-button[aria-label="Zur Spielstättenübersicht"]').click();
  await expect(page.getByRole('button', { name: 'Maß hinzufügen', exact: true })).toBeVisible();

  await page.locator('[data-testid^="curtain-"]').click();
  await showProperties(page);
  await page.getByTestId('venue-curtain-open').fill('60');
  await page.locator('form', { has: page.getByTestId('venue-curtain-open') }).getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('[data-testid^="curtain-"]')).toContainText('offen 60%');

  await page.locator('[data-testid^="venue-wall-"]').click();
  const leaf = page.locator('[data-testid^="venue-door-leaf-"]');
  await expect(leaf).toHaveAttribute('y2', '0');
  await page.getByTestId('venue-door-open').fill('100');
  await page.locator('form', { has: page.getByTestId('venue-door-open') }).getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(leaf).not.toHaveAttribute('y2', '0');
});
