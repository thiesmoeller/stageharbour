import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Reveal the shared dock before opening a property section. */
export async function showProperties(page: Page) {
  const button = page.getByRole('button', { name: 'Eigenschaften', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}

/** Open a workspace tray through its visible disclosure control. */
export async function openInspector(page: Page, title: string) {
  if (title === 'Wandtypen / Öffnungen') {
    const library = page.getByRole('button', { name: 'Bibliothek', exact: true });
    if (await library.getAttribute('aria-expanded') !== 'true') await library.click();
  } else await showProperties(page);
  const panel = page.locator('.inspector-section').filter({ has: page.locator('summary', { hasText: title }) });
  // Avoid Playwright "stable" waits: CI software WebGL keeps nearby canvases dirty.
  await panel.evaluate(element => { (element as HTMLDetailsElement).open = true; });
}

/** Open the library dock (and optionally switch to a named tab). */
export async function openLibrary(page: Page, tab?: string) {
  const library = page.getByRole('region', { name: 'Bibliothek', exact: true });
  if (!(await library.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
  }
  await expect(library).toBeVisible();
  if (tab) await library.getByRole('button', { name: tab, exact: true }).click();
  return library;
}

/** Click the plan to commit an in-progress wall ghost at plan coordinates (mm). */
export async function commitWallPlacement(
  page: Page,
  x = 4000,
  y = 3000,
  _testId = 'placing-wall',
  { bypassSnap = false }: { bypassSnap?: boolean } = {},
) {
  await expect(page.locator('.plan-placement-hint')).toBeVisible();
  await page.locator('.plan-canvas > svg').scrollIntoViewIfNeeded();
  const screen = await page.locator('.plan-canvas > svg').evaluate((svg, point) => {
    const ctm = (svg as SVGSVGElement).getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const mapped = new DOMPoint(point.x, -point.y).matrixTransform(ctm);
    return { x: mapped.x, y: mapped.y };
  }, { x, y });
  if (bypassSnap) await page.keyboard.down('Alt');
  await page.mouse.click(screen.x, screen.y);
  if (bypassSnap) await page.keyboard.up('Alt');
  await expect(page.locator('.plan-placement-hint')).toHaveCount(0);
}

export const commitObjectPlacement = (
  page: Page,
  x = 4000,
  y = 3000,
  options?: { bypassSnap?: boolean },
) => commitWallPlacement(page, x, y, 'placing-object', options);

/** Plan wall groups only — avoid RAL picker testids that also start with wall-. */
export function planWalls(page: Page) {
  return page.locator('.plan-canvas g[data-testid^="object-"][aria-label^="Wandelement"]');
}

/** Start wall placement from the tool rail and commit at plan coordinates (mm). */
export async function placeWallAt(page: Page, x = 4000, y = 3000) {
  await page.getByRole('button', { name: 'Wandelement · Glattwand einsetzen', exact: true }).click();
  await commitWallPlacement(page, x, y);
  await showProperties(page);
}

/** Tool-rail categories whose list holds the parts that are not the category's first choice. */
const TOOL_CATEGORY: Record<string, string> = { 'Treppe einsetzen': 'Podeste', 'Tür einsetzen': 'Wände', 'Stuhl einsetzen': 'Möbel' };

/** Pick a part from the tool rail: directly, or from its category list. */
export async function chooseTool(page: Page, name: string) {
  const direct = page.getByRole('button', { name, exact: true });
  const category = TOOL_CATEGORY[name];
  if (!category || await direct.count()) { await direct.click(); return; }
  await page.getByRole('button', { name: `${category}: weitere Bauteile`, exact: true }).click();
  await page.getByRole('dialog', { name: category }).getByRole('button', { name: name.replace(/ einsetzen$/, ''), exact: true }).click();
}

/** Start a preview placement from a named button and commit at plan coordinates (mm). */
export async function placeNamedObjectAt(page: Page, name: string, x = 4000, y = 3000) {
  const replacement: Record<string, string> = {
    'Stütze hinzufügen': 'Stützdreieck · 50 × 120 cm einsetzen',
    'Kiste hinzufügen': 'Kiste einsetzen',
    'Tisch hinzufügen': 'Tisch einsetzen',
    'Podest hinzufügen': 'Bühnenelement · 2 × 1 m einsetzen',
    'Treppe hinzufügen': 'Treppe einsetzen',
  };
  await chooseTool(page, replacement[name] ?? name);
  await commitObjectPlacement(page, x, y);
  await showProperties(page);
}
