import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('production surface registry uploads a measured glTF-PBR texture set', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'OberflächenProbe',
    venueName: 'Materialsaal',
    sceneName: 'Texturszene',
  });
  await expect(page.getByRole('heading', { name: 'Texturszene' })).toBeVisible();
  await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
  await page.getByRole('button', { name: 'Oberfläche hochladen' }).click();
  const form = page.locator('.surface-registry form');
  await form.getByLabel('Name').fill('Eigenes Eichenparkett');
  await form.getByLabel('Kachelbreite (mm)').fill('1200');
  await form.getByLabel('Kachelhöhe (mm)').fill('600');
  await form.getByLabel('Base Color / Albedo (sRGB) *').setInputFiles({
    name: 'oak_basecolor.png', mimeType: 'image/png', buffer: onePixelPng,
  });
  await form.getByRole('button', { name: 'Hochladen und anlegen' }).click();
  const entry = page.locator('.surface-registry-item').filter({ hasText: 'Eigenes Eichenparkett' });
  await expect(entry).toContainText('Nur diese Produktion');
  await expect(entry).toContainText('1200 × 600 mm');
  await expect(entry.locator('img')).toBeVisible();

  await page.getByRole('button', { name: 'Poly Haven durchsuchen' }).click();
  const catalog = page.locator('.surface-catalog');
  await catalog.getByLabel('CC0-Material suchen').fill('theatre');
  await catalog.getByRole('button', { name: 'Suchen' }).click();
  const material = catalog.locator('.surface-catalog-item').filter({ hasText: 'Theatre Wood' });
  await expect(material).toContainText('2000 × 1000 mm');
  await material.getByRole('button', { name: 'Importieren' }).click();
  const imported = page.locator('.surface-registry-item').filter({ hasText: 'Theatre Wood' });
  await expect(imported).toContainText('Nur diese Produktion');
});
