import { test, expect } from '@playwright/test';
import { signInToPlans } from '../helpers/plans.js';

test('open-part Designer fills the viewport without document scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInToPlans(page);
  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Bühnentechnik/ }).click();
  await expect(page.getByTestId('designer-page')).toHaveAttribute('data-mode', 'library');
  await page.getByTestId('designer-starters').getByRole('button', { name: 'Tisch als Kopie anlegen' }).click();
  await expect(page).toHaveURL(/#\/designer\/[0-9a-f-]{36}$/);

  const shell = page.getByTestId('designer-page');
  await expect(shell).toHaveAttribute('data-mode', 'modelling');
  await expect(shell).toHaveClass(/designer-shell/);
  await expect(page.getByTestId('designer-back')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Arbeitsbereiche' })).toBeHidden();
  await expect(page.locator('.workspace-heading')).toBeHidden();

  // Hide the openings sketcher so the 3D cell owns the centre column height.
  await page.getByTestId('designer-tab-outline').click();
  await page.getByTestId('designer-section-outline').getByRole('button', { name: /Bein/ }).first().click();
  await expect(page.getByTestId('designer-face-sketcher')).toHaveCount(0);

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const canvas = document.querySelector('.designer-model .designer-canvas');
    const gl = document.querySelector('.designer-model .designer-canvas canvas');
    const box = canvas?.getBoundingClientRect();
    const glBox = gl?.getBoundingClientRect();
    return {
      scrollOverflow: doc.scrollHeight - doc.clientHeight,
      canvasHeight: box?.height ?? 0,
      glHeight: glBox?.height ?? 0,
      viewportHeight: window.innerHeight,
    };
  });
  expect(metrics.scrollOverflow).toBeLessThan(8);
  expect(metrics.canvasHeight).toBeGreaterThan(metrics.viewportHeight * 0.5);
  expect(metrics.glHeight).toBeGreaterThan(metrics.viewportHeight * 0.45);

  await page.getByTestId('designer-tab-views').click();
  await expect(page.getByTestId('designer-section-views')).toBeVisible();
  await expect(page.getByTestId('designer-view-front')).toBeVisible();
});
