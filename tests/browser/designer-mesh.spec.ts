import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { commitObjectPlacement, openLibrary, showProperties } from '../helpers/inspector.js';

test('nested GLB insertion, calibration, breadcrumbs, scene render and stock stay separate', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  const partId = await page.evaluate(async () => {
    const me = await (await fetch('/api/me')).json();
    const base = `/api/workspaces/${me.workspace.id}`;
    const leaf = { id: crypto.randomUUID(), revision: 1, name: 'Türblatt', category: 'Test', parameters: [], bodies: [{ kind: 'box', key: 'leaf', material: 'gummifuss-50', at: [450, 1000, 0], size: [900, 2000, 40] }], traits: { stock: 'none' } };
    const door = { ...leaf, id: crypto.randomUUID(), name: 'Türgruppe', bodies: [], children: [{ key: 'leaf-group', label: 'Türblatt', group: leaf, at: [0, 0, 0] }] };
    const wall = { ...leaf, id: crypto.randomUUID(), name: 'Mesh-Testwand', bodies: [], children: [{ key: 'door', label: 'Türgruppe', group: door, at: [0, 0, 0] }] };
    const response = await fetch(`${base}/parts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ definition: wall }) });
    if (!response.ok) throw new Error(await response.text());
    const fav = await fetch(`${base}/parts/${wall.id}/favourite`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ favourite: true }) });
    if (!fav.ok) throw new Error(await fav.text());
    return wall.id;
  });
  await page.goto(`/#/designer/${partId}`);
  await expect(page.getByTestId('designer-title')).toHaveText('Mesh-Testwand');
  for (const name of ['Türgruppe', 'Türblatt']) {
    await page.locator('#designer-hierarchy').getByRole('button', { name: new RegExp(`^${name} Gruppe`) }).click();
    await page.getByTestId('designer-enter-child').click();
    await expect(page.getByTestId('designer-inplace')).toContainText(name);
  }
  await expect(page.getByTestId('designer-breadcrumbs').getByRole('button', { name: 'Mesh-Testwand' })).toBeVisible();
  await expect(page.getByTestId('designer-breadcrumbs').getByRole('button', { name: 'Türblatt' })).toHaveAttribute('aria-current', 'page');
  await page.locator('#designer-hierarchy').getByRole('button', { name: 'Suchen', exact: true }).click();
  await page.locator('#designer-hierarchy .library-row').getByRole('button', { name: 'Importieren', exact: true }).click();
  await page.locator('#designer-hierarchy').getByRole('button', { name: 'In Bauteil einfügen', exact: true }).click();
  await page.getByLabel('Länge (mm)', { exact: true }).fill('120');
  await page.getByLabel('Drehung Y (°)', { exact: true }).fill('90');
  await page.getByRole('button', { name: 'Maße übernehmen' }).click();
  await expect(page.getByTestId('designer-preview')).toHaveAttribute('data-solids', '2');
  await page.getByTestId('designer-leave-child').click();
  await expect(page.getByTestId('designer-inplace')).toContainText('Türgruppe');
  await page.getByTestId('designer-breadcrumbs').getByRole('button', { name: 'Mesh-Testwand' }).click();
  await expect(page.getByTestId('designer-inplace')).toHaveCount(0);
  await expect(page.getByTestId('designer-preview')).toHaveAttribute('data-solids', '2');
  await page.getByTestId('designer-save').click();
  await expect(page.getByTestId('designer-status')).toContainText('Gespeichert');
  const saved = await page.evaluate(async id => {
    const me = await (await fetch('/api/me')).json();
    return (await fetch(`/api/workspaces/${me.workspace.id}/parts/${id}`)).json();
  }, partId);
  expect(JSON.stringify(saved.definition)).toContain('"kind":"mesh"');
  await page.reload();
  await expect(page.getByTestId('designer-preview')).toHaveAttribute('data-solids', '2');
  const frame = await page.locator('.designer-model .designer-canvas').boundingBox();
  const inspector = await page.locator('.designer-right').boundingBox();
  expect(frame!.height).toBeGreaterThan(300);
  expect(inspector!.x).toBeGreaterThan(frame!.x);
  await page.getByRole('button', { name: 'Bibliothek / Gliederung' }).click();
  await expect(page.locator('#designer-hierarchy')).toBeHidden();

  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Produktionen/ }).click();
  await createProduction(page, { productionName: 'Mesh-Bühnenbild', venueName: 'Mesh-Saal', sceneName: 'Griffprobe' });
  const library = await openLibrary(page);
  const parts = library.locator('.part-library');
  await expect(parts).toContainText('Mesh-Testwand');
  await parts.locator('.library-row').filter({ hasText: 'Mesh-Testwand' }).getByRole('button', { name: 'Einsetzen' }).click();
  await commitObjectPlacement(page, 3500, 3000);
  await expect(page.locator('[data-testid^="object-"][aria-label="Mesh-Testwand"]')).toBeVisible();
  await showProperties(page);
  const stock = page.getByLabel('Bestandsstück', { exact: true });
  await expect(stock).toBeVisible();
  await expect(stock.locator('option')).toHaveCount(1);
  await expect(stock.locator('option')).toHaveText('Kein Bestandsstück');
  await page.getByRole('button', { name: 'Raumsicht', exact: true }).click();
  await expect(page.locator('.stage-view canvas')).toBeVisible();
  await expect(page.getByTestId('stage-mesh-solids')).toHaveAttribute('data-count', '1', { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Modelldatei fehlt' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
