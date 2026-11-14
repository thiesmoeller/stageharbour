import { showProperties } from '../helpers/inspector.js';
import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { revealEditorCommand } from '../helpers/editorMenus.js';

test('Traversen hang points, Scheinwerfer assign, and display toggles', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'LichtHang',
    venueName: 'HangSaal',
    sceneName: 'HangLook',
  });
  await expect(page.getByRole('heading', { name: 'HangLook', exact: true })).toBeVisible();
  await revealEditorCommand(page, 'Spielstätte');
  await page.getByRole('button', { name: 'Spielstätte bearbeiten' }).click();
  await expect(page.getByRole('heading', { name: 'HangSaal', exact: true })).toBeVisible();
  await showProperties(page);

  await page.getByRole('button', { name: 'Traverse zeichnen' }).click();
  const venueSvg = page.locator('svg[aria-label="Umriss der Spielstätte"]');
  const box = await venueSvg.boundingBox();
  if (!box) throw new Error('venue plan missing');
  await venueSvg.click({ position: { x: box.width * 0.25, y: box.height * 0.45 } });
  await venueSvg.click({ position: { x: box.width * 0.75, y: box.height * 0.45 } });
  await expect(page.locator('[data-testid^="truss-"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Scheinwerfer Gerätetyp wählen' }).click();
  await page.getByRole('menuitem', { name: /Fresnel/ }).click();
  await venueSvg.hover({ position: { x: box.width * 0.4, y: box.height * 0.35 } });
  await expect(page.getByTestId('hang-placement-preview')).toBeVisible();
  await expect(page.locator('[data-hang-target]')).toHaveCount(1);
  await venueSvg.click({ position: { x: box.width * 0.4, y: box.height * 0.45 } });
  const hangFields = page.locator('[data-testid^="hang-point-fields-"]').first();
  await expect(hangFields).toBeVisible();
  await expect(hangFields.getByLabel(/Aufhängepunkt .* Scheinwerfer/)).toHaveValue('fresnel');
  await expect(hangFields.getByText('Flügelblenden')).toBeVisible();
  await hangFields.getByLabel(/Scheinwerfer .* Bezeichnung/).fill('F1');

  await revealEditorCommand(page, 'Spielstätte speichern');
  await page.getByRole('button', { name: 'Spielstätte speichern' }).click();
  await expect(page.getByText('Spielstättenfassung gespeichert', { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Auswählen' }).click();
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Traversen' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Traversen' }).uncheck();
  await expect(page.locator('[data-testid^="truss-"]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Traversen' }).check();
  await expect(page.locator('[data-testid^="truss-"]').first()).toBeVisible();

  await page.getByRole('checkbox', { name: 'Scheinwerfer' }).uncheck();
  await expect(page.locator('[data-testid^="lighting-fixture-mark-"]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Scheinwerfer' }).check();
  await expect(page.locator('[data-testid^="lighting-fixture-mark-"]').first()).toBeVisible();

  const glErrors: string[] = [];
  page.on('console', msg => {
    if (/INVALID_OPERATION|no buffer is bound/i.test(msg.text())) glErrors.push(msg.text());
  });
  await page.getByRole('button', { name: 'Raumansicht', exact: true }).click();
  await expect(page.getByTestId('stage-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-renderer="stage"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Licht', exact: true }).click();
  const theatre = page.getByLabel('Bühnenlicht aktivieren');
  const grund = page.locator('details.lighting-panel').first();
  if (!(await grund.getAttribute('open'))) await grund.locator('summary').click();
  if (await theatre.isChecked()) await theatre.uncheck();
  await expect(theatre).not.toBeChecked();
  await page.getByRole('button', { name: 'Lichtpult', exact: true }).click();
  await expect(theatre).toBeChecked();
  await expect(page.getByTestId('light-board')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alle an' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alle aus' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Blackout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Alle aus' }).click();
  await page.locator('.light-board-on').first().click();
  await expect(page.getByTestId('fixture-desk')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Licht', exact: true }).getByTestId('fixture-desk')).toBeVisible();
  const topFlap = page.getByRole('slider', { name: 'F1 Flügelblende Oben' });
  await expect(topFlap).toHaveValue('0');
  await topFlap.fill('70');
  await expect(topFlap).toHaveValue('70');
  const typeSelect = page.getByLabel('F1 Gerätetyp');
  await expect(typeSelect).toBeVisible();
  await typeSelect.selectOption('flood');
  await expect(typeSelect).toHaveValue('flood');
  await expect(page.getByTestId('light-board')).toBeVisible();
  const started = Date.now();
  await expect.poll(() => (Date.now() - started < 2000 ? -1 : glErrors.length)).toBe(0);
});
