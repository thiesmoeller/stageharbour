import { test, expect, type Page } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { enterVenue } from '../helpers/editorShell.js';
import { openInspector, showProperties } from '../helpers/inspector.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

async function waitUntilSaved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
}

async function planPoint(page: Page, x: number, y: number, selector = 'svg[aria-label="Umriss der Spielstätte"]') {
  await page.locator(selector).scrollIntoViewIfNeeded();
  return page.locator(selector).evaluate((element, p) => {
    const result = new DOMPoint(p.x, -p.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: result.x, y: result.y };
  }, { x, y });
}

test('venue audience viewpoint places in front of chairs, persists, and drives Publikumssicht', async ({ page }) => {
  test.setTimeout(120_000);
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'PublikumssichtProbe',
    venueName: 'Parkettsaal',
    sceneName: 'BlickSzene',
  });
  await expect(page.getByRole('heading', { name: 'BlickSzene' })).toBeVisible();
  await waitUntilSaved(page);

  await enterVenue(page);
  const tools = page.locator('.venue-editor .tool-rail');
  await tools.getByRole('button', { name: 'Stuhl setzen' }).click();
  const chair = await planPoint(page, 4000, 900);
  await page.mouse.click(chair.x, chair.y);
  await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(1);

  await tools.getByRole('button', { name: 'Zuschauer-Blickpunkt wählen' }).click();
  await expect(page.getByTestId('audience-viewpoint')).toBeVisible();
  await expect(page.getByTestId('audience-viewpoint-fields')).toBeVisible();
  await page.getByRole('button', { name: 'Vor Stühlen platzieren' }).click();
  await expect(page.getByLabel('Blickpunkt Y (mm)')).not.toHaveValue('900');
  const placedY = Number(await page.getByLabel('Blickpunkt Y (mm)').inputValue());
  expect(placedY).toBeLessThan(900 - 200);
  await expect(page.getByLabel('Augenhöhe (mm)')).toHaveValue('1200');
  await expect(page.getByLabel('Bezeichnung')).toHaveValue('Parkett vorn');

  const origin = page.getByTestId('audience-viewpoint-origin');
  const box = await origin.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 - 30, { steps: 8 });
  await page.mouse.up();
  const draggedX = await page.getByLabel('Blickpunkt X (mm)').inputValue();
  const draggedY = await page.getByLabel('Blickpunkt Y (mm)').inputValue();

  const saved = page.waitForResponse(
    response => /\/scenes\/[^/]+\/venue$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT',
    { timeout: 30_000 },
  );
  await revealEditorCommand(page, 'Spielstätte speichern');
  await page.getByRole('button', { name: 'Spielstätte speichern' }).click({ force: true });
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByText('Spielstättenfassung gespeichert', { exact: true })).toBeVisible({ timeout: 15_000 });

  await revealEditorCommand(page, 'Spielstätte schließen');
  await page.getByRole('button', { name: 'Spielstätte schließen' }).click({ force: true });
  await expect(page.getByRole('heading', { name: 'BlickSzene' })).toBeVisible();

  await page.getByRole('button', { name: 'Raumansicht', exact: true }).click();
  await page.getByRole('button', { name: 'Publikumssicht' }).click();
  await expect(page.getByTestId('stage-view')).toHaveAttribute('data-view', 'audience');
  await showProperties(page);
  await expect(page.getByText(/Blick vom Zuschauer-Blickpunkt/)).toBeVisible();

  await enterVenue(page);
  await openInspector(page, 'Zuschauer-Blickpunkt');
  await expect(page.getByLabel('Blickpunkt X (mm)')).toHaveValue(draggedX);
  await expect(page.getByLabel('Blickpunkt Y (mm)')).toHaveValue(draggedY);
  await expect(page.getByLabel('Bezeichnung')).toHaveValue('Parkett vorn');
  await expect(page.getByTestId('audience-viewpoint')).toBeVisible();
});
