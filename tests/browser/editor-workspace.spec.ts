import { test, expect } from '@playwright/test';
import { testAdministrator } from '../helpers/database.js';
import { openInspector, placeWallAt } from '../helpers/inspector.js';

test('editor keeps the canvas in view, preserves tray drafts, and adapts to smaller screens', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('E-Mail-Adresse').fill(testAdministrator.email);
  await page.getByLabel('Passwort', { exact: true }).fill(testAdministrator.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Neues Bühnenbild' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill('Der eingebildete Kranke');
  await page.getByRole('textbox', { name: 'Spielstätte' }).fill('Theatersaal');
  await page.getByRole('textbox', { name: 'Szene' }).fill('Erster Akt · Das Zimmer');
  await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill('8000');
  await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill('6000');
  await page.getByRole('button', { name: 'Bühnenbild anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Keine Auswahl' })).toBeVisible();
  const wallTypes = page.locator('.inspector-section').filter({ has: page.locator('summary', { hasText: 'Wandtypen' }) });
  await expect(wallTypes).not.toHaveAttribute('open');
  await openInspector(page, 'Wandtypen');
  await page.getByRole('button', { name: 'Wandtyp anlegen' }).click();
  await page.getByLabel('Wandtyp-Bezeichnung').fill('Türwand im Entwurf');
  const viewsWidth = (await page.locator('.editor-views').boundingBox())!.width;
  await page.getByRole('button', { name: 'Eigenschaften', exact: true }).click();
  await expect(page.locator('.wall-inspector')).toBeHidden();
  expect((await page.locator('.editor-views').boundingBox())!.width).toBeGreaterThan(viewsWidth + 200);
  await page.getByRole('button', { name: 'Eigenschaften', exact: true }).click();
  await expect(page.getByLabel('Wandtyp-Bezeichnung')).toHaveValue('Türwand im Entwurf');
  await wallTypes.locator('summary').click();
  await openInspector(page, 'Wandtypen');
  await expect(page.getByLabel('Wandtyp-Bezeichnung')).toHaveValue('Türwand im Entwurf');
  await wallTypes.locator('summary').click();

  for (const [x, y, rotation] of [[2000, 4500, 0], [3200, 4500, 0], [4400, 4500, 0], [5600, 4500, 0], [1400, 3900, 90]]) {
    await placeWallAt(page, x, y);
    await page.locator('#wall-x').fill(String(x));
    await page.locator('#wall-y').fill(String(y));
    await page.locator('#wall-rotation').fill(String(rotation));
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  }
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await expect(page.getByRole('img', { name: 'Grundriss der Spielstätte', exact: true })).toBeInViewport();
  await expect(page.getByRole('img', { name: 'Raumsicht der Spielstätte', exact: true })).toBeInViewport();
  await expect(page.locator('#wall-x')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);

  await page.getByRole('button', { name: 'Raumansicht', exact: true }).click();
  await expect(page.locator('.plan-canvas')).toBeHidden();
  for (const [label, view] of [['Von oben', 'top'], ['Von vorne', 'front'], ['Von der Seite', 'side'], ['Publikumssicht', 'audience'], ['Umlaufansicht', 'orbit']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByTestId('stage-view')).toHaveAttribute('data-view', view);
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Von oben', exact: true }).click();
  await page.getByRole('button', { name: 'Einfache Darstellung', exact: true }).click();
  await expect(page.getByTestId('stage-view')).toHaveAttribute('data-view', 'orbit');
  await page.getByRole('button', { name: 'Erweiterte Darstellung', exact: true }).click();
  await expect(page.locator('[data-renderer="pascal"] canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Bühne einpassen', exact: true }).click();
  await page.getByRole('button', { name: 'Bühne einpassen', exact: true }).click();
  await expect(page.getByLabel('Ansichten aufteilen')).toBeHidden();
  await page.getByRole('button', { name: 'Grundriss', exact: true }).click();
  await expect(page.getByTestId('stage-view')).toHaveCount(0);
  await expect(page.locator('#wall-x')).toHaveValue('1400');
  await page.getByRole('button', { name: '2D + 3D', exact: true }).click();
  await expect(page.locator('[data-renderer="pascal"] canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Bedienung', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Arbeiten im Grundriss' })).toBeVisible();
  await page.getByRole('button', { name: 'Bedienung', exact: true }).click();
  // Allow the remounted WebGL viewer to draw before capturing the visual artifact.
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/editor-workspace-desktop.png' });

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('button', { name: 'Zur Übersicht' })).toBeInViewport();
  await expect(page.locator('.workspace-statusbar')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Wand hinzufügen', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#wall-x').scrollIntoViewIfNeeded();
  await expect(page.locator('#wall-x')).toBeInViewport();
  await page.screenshot({ path: 'test-results/editor-workspace-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
