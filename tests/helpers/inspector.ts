import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Open a workspace tray through its visible disclosure control. */
export async function openInspector(page: Page, title: string) {
  const panel = page.locator('.inspector-section').filter({ has: page.locator('summary', { hasText: title }) });
  if (await panel.getAttribute('open') === null) await panel.locator('summary').click();
}

/** Click the plan to commit an in-progress wall ghost at plan coordinates (mm). */
export async function commitWallPlacement(page: Page, x = 4000, y = 3000, testId = 'placing-wall') {
  await expect(page.getByTestId(testId)).toBeAttached();
  await page.locator('.plan-canvas > svg').scrollIntoViewIfNeeded();
  const screen = await page.locator('.plan-canvas > svg').evaluate((svg, point) => {
    const ctm = (svg as SVGSVGElement).getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const mapped = new DOMPoint(point.x, -point.y).matrixTransform(ctm);
    return { x: mapped.x, y: mapped.y };
  }, { x, y });
  await page.mouse.click(screen.x, screen.y);
  await expect(page.getByTestId(testId)).toHaveCount(0);
}

export const commitObjectPlacement = (page: Page, x = 4000, y = 3000) => commitWallPlacement(page, x, y, 'placing-object');

/** Start wall placement from the tool rail and commit at plan coordinates (mm). */
export async function placeWallAt(page: Page, x = 4000, y = 3000) {
  await page.getByRole('button', { name: 'Wand hinzufügen', exact: true }).click();
  await commitWallPlacement(page, x, y);
}
