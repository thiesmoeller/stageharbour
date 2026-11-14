import { expect, test } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { openLibrary } from '../helpers/inspector.js';

test('a Poly Haven GLB can be placed on the scene and on the venue', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Requisiten', venueName: 'Saal', sceneName: 'Bild' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');

  const library = await openLibrary(page);
  await library.getByRole('button', { name: 'Suchen', exact: true }).click();
  await library.getByRole('button', { name: 'Importieren', exact: true }).click();
  await expect(library.getByRole('button', { name: 'Setzen', exact: true })).toBeVisible();
  await library.getByRole('button', { name: 'Setzen', exact: true }).click();
  await expect(page.locator('.plan-placement-hint')).toContainText('Kiste');

  const screen = await page.locator('.plan-canvas > svg').evaluate(svg => {
    const ctm = (svg as SVGSVGElement).getScreenCTM();
    const mapped = new DOMPoint(3000, -2500).matrixTransform(ctm!);
    return { x: mapped.x, y: mapped.y };
  });
  const file = page.waitForResponse(response => response.url().includes('/assets/files/') && response.ok());
  await page.mouse.click(screen.x, screen.y);
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Raumsicht', exact: true }).click();
  await file;
  await expect(page.locator('.stage-view canvas')).toBeVisible();

  await revealEditorCommand(page, 'Spielstätte bearbeiten');
  await page.getByRole('button', { name: 'Spielstätte bearbeiten', exact: true }).click();
  const venueLibrary = await openLibrary(page);
  await venueLibrary.getByRole('button', { name: 'Setzen', exact: true }).click();
  const venuePlan = page.getByRole('img', { name: 'Umriss der Spielstätte' });
  await venuePlan.click({ position: { x: 180, y: 140 } });
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Raumansicht', exact: true }).click();
  await expect(page.locator('.stage-view canvas')).toBeVisible();
});
