import { expect, test } from '@playwright/test';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

test('notebook editor keeps generic part commands discoverable and gives the canvas the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Notebook-Produktion', venueName: 'Kleiner Saal', sceneName: 'Erste Szene' });
  const menu = (name: string) => page.locator('.editor-menubar summary').filter({ hasText: new RegExp(`^${name}$`) });
  const canvas = page.getByRole('img', { name: 'Grundriss der Spielstätte', exact: true });

  for (const [width, height] of [[1366, 768], [1280, 720]] as const) {
    await page.setViewportSize({ width, height });
    await expect(canvas).toBeInViewport();
    const bounds = (await canvas.boundingBox())!;
    expect(bounds.y).toBeLessThanOrEqual(150);
    expect(bounds.height).toBeGreaterThan(height * .6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  await menu('Datei').click();
  await expect(page.getByRole('button', { name: 'Ausgabe erstellen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu('Datei')).toBeFocused();

  await page.getByRole('button', { name: 'Wandelement · Glattwand einsetzen', exact: true }).click();
  await expect(page.locator('.plan-placement-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.plan-placement-hint')).toHaveCount(0);

  await menu('Bearbeiten').click();
  await expect(page.getByRole('button', { name: 'Kopieren', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Umbenennen', exact: true }).click();
  await page.getByLabel('Name des Bühnenbilds').fill('Umbenannte Szene');
  await page.getByRole('dialog', { name: 'Bühnenbild umbenennen' }).getByRole('button', { name: 'Umbenennen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Umbenannte Szene', exact: true })).toBeVisible();

  await revealEditorCommand(page, 'Raumsicht');
  await page.getByRole('button', { name: 'Raumsicht', exact: true }).click();
  await expect(page.getByTestId('stage-view')).toBeVisible();
});
