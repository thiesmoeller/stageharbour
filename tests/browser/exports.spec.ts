import { revealEditorCommand } from '../helpers/editorMenus.js';
import { openInspector, placeWallAt } from '../helpers/inspector.js';

async function pdfWords(bytes: Buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const params = { data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false };
  const document = await getDocument(params as never).promise;
  const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
    const pdfPage = await document.getPage(index + 1);
    const content = await pdfPage.getTextContent();
    return content.items.map(item => 'str' in item ? item.str : '').join(' ');
  }));
  return pages.join('\n');
}
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';

async function waitUntilSaved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
}

test('export a named frozen construction plan and download it from history', async ({ page }) => {
  test.setTimeout(120_000);
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Exportprobe',
    venueName: 'Probesaal',
    sceneName: 'Erste Szene',
  });
  await expect(page.getByRole('heading', { name: 'Erste Szene' })).toBeVisible();
  await waitUntilSaved(page);
  await placeWallAt(page);
  await waitUntilSaved(page);
  await openInspector(page, 'Aufbau & Verbindungen');
  await page.getByRole('button', { name: 'Montagenummern vergeben' }).click();
  await waitUntilSaved(page);
  await expect(page.locator('[data-testid^="assembly-label-"]')).toHaveText(['1']);
  await revealEditorCommand(page, 'Konstruktionsplan');
  await page.getByRole('button', { name: 'Konstruktionsplan' }).click();
  const workspace = page.getByRole('region', { name: 'Export' });
  await workspace.getByLabel('Bezeichnung der Fassung').fill('Probeexport');
  await expect(workspace.getByRole('status').first()).toContainText('Vorschau bereit', { timeout: 20_000 });
  await workspace.getByRole('button', { name: 'PDF erstellen' }).click();
  await workspace.getByText('Frühere Fassungen').click();
  await expect(workspace.getByRole('listitem').filter({ hasText: 'Probeexport' })).toBeVisible();
  await expect(workspace.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('Fertig');
  await expect(workspace.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('A4');
  await expect(workspace.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('1:50');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    workspace.getByRole('listitem').filter({ hasText: 'Probeexport' }).getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = readFileSync(await download.path() as string);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = await pdfWords(bytes);
  expect(text).toContain('Position 1');
  expect(text).toContain('Verbindungskompatibilität prüft die Crew manuell');
  expect(text).toContain('Maßstab 1:50');
  await workspace.getByLabel('Papierformat', { exact: true }).selectOption('A3');
  await workspace.getByLabel('Maßstab', { exact: true }).selectOption('25');
  await workspace.getByLabel('Bezeichnung der Fassung').fill('A3-Detail');
  await expect(workspace.getByRole('status').first()).toContainText('Vorschau bereit', { timeout: 20_000 });
  await workspace.getByRole('button', { name: 'PDF erstellen' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'A3-Detail' })).toContainText('Fertig');
  await expect(page.getByRole('listitem').filter({ hasText: 'A3-Detail' })).toContainText('A3');
  await expect(page.getByRole('listitem').filter({ hasText: 'A3-Detail' })).toContainText('1:25');
  const [a3Download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('listitem').filter({ hasText: 'A3-Detail' }).getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  const a3Bytes = readFileSync(await a3Download.path() as string);
  expect(a3Bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(a3Bytes.toString('latin1')).toMatch(/\/MediaBox \[0 0 (?:841\.889764 1190\.551181|1190\.551181 841\.889764)\]/);
  await workspace.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByTestId('export-workspace')).toBeHidden();
  await placeWallAt(page, 2000, 4500);
  await waitUntilSaved(page);
  await page.getByLabel('Auswahl').selectOption({ label: '1. Wand' });
  await page.locator('[data-testid^="wall-"]').nth(1).click({ modifiers: ['Shift'] });
  await revealEditorCommand(page, 'Gruppieren');
  await page.getByRole('button', { name: 'Gruppieren' }).click();
  await waitUntilSaved(page);
  await revealEditorCommand(page, 'Konstruktionsplan');
  await page.getByRole('button', { name: 'Konstruktionsplan', exact: true }).click();
  const planExport = page.getByRole('region', { name: 'Export' });
  await planExport.getByRole('checkbox', { name: /Gruppe 1/ }).check();
  await planExport.getByLabel('Bezeichnung der Fassung').fill('Ansichtsexport');
  await planExport.getByLabel('Papierformat', { exact: true }).selectOption('A4');
  await planExport.getByLabel('Maßstab', { exact: true }).selectOption('50');
  await expect(planExport.getByRole('status').first()).toContainText('Vorschau bereit', { timeout: 20_000 });
  await planExport.getByRole('button', { name: 'PDF erstellen' }).click();
  await planExport.getByText('Frühere Fassungen').click();
  await expect(planExport.getByRole('listitem').filter({ hasText: 'Ansichtsexport' })).toContainText('Fertig');
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('A4');
  await expect(page.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('1:50');
  const [elevationDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('listitem').filter({ hasText: 'Ansichtsexport' }).getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  const elevationBytes = readFileSync(await elevationDownload.path() as string);
  expect(elevationBytes.subarray(0, 5).toString()).toBe('%PDF-');
  const elevationText = await pdfWords(elevationBytes);
  expect(elevationText).toContain('Frontansicht');
  expect(elevationText).toContain('Ansicht 0°');
  expect(elevationText).toContain('Maßstab 1:50');
  expect(elevationBytes.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.275591 841\.889764\]/);
  await planExport.getByLabel('Umfang').selectOption('package');
  await planExport.getByLabel('Bezeichnung der Fassung').fill('Paketexport');
  await expect(planExport.getByRole('status').first()).toContainText('Vorschau bereit', { timeout: 20_000 });
  await planExport.getByRole('button', { name: 'PDF erstellen' }).click();
  await expect(planExport.getByRole('listitem').filter({ hasText: 'Paketexport' })).toContainText('Fertig');
  await expect(page.getByRole('listitem').filter({ hasText: 'Paketexport' })).toContainText('A4');
  await expect(page.getByRole('listitem').filter({ hasText: 'Paketexport' })).toContainText('1:50');
  const [packageDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('listitem').filter({ hasText: 'Paketexport' }).getByRole('button', { name: 'Herunterladen' }).click(),
  ]);
  expect(packageDownload.suggestedFilename()).toMatch(/konstruktionspaket-.*\.pdf$/);
  const packageBytes = readFileSync(await packageDownload.path() as string);
  expect(packageBytes.subarray(0, 5).toString()).toBe('%PDF-');
  const packageText = await pdfWords(packageBytes);
  expect(packageText).toContain('Stückliste');
  expect(packageText).toContain('Konstruktionspaket');
  expect(packageText).toContain('Maßstab 1:50');
  expect(packageBytes.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.275591 841\.889764\]/);
  await planExport.getByLabel('Umfang').selectOption('scene');
  const history = planExport.locator('details').filter({ hasText: 'Frühere Fassungen' });
  if (await history.getAttribute('open') === null) await history.locator('summary').click();
  await expect(planExport.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('A4');
  await expect(planExport.getByRole('listitem').filter({ hasText: 'Probeexport' })).toContainText('1:50');
});

test('export Raumsicht capture embeds a client PNG into the PDF', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'Raumsicht-Export',
    venueName: 'Fangraum',
    sceneName: 'Blickfang',
  });
  await expect(page.getByRole('heading', { name: 'Blickfang' })).toBeVisible();
  await waitUntilSaved(page);
  await revealEditorCommand(page, 'Konstruktionsplan');
  await page.getByRole('button', { name: 'Konstruktionsplan' }).click();
  const workspace = page.getByRole('region', { name: 'Export' });
  await workspace.getByRole('button', { name: 'Raumsicht hinzufügen' }).click();
  const aim = workspace.getByTestId('export-stage-aim');
  await expect(aim.locator('[data-renderer="pascal"] canvas')).toBeVisible({ timeout: 30_000 });
  const btn = aim.getByTestId('export-capture-view');
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await btn.click();
  await expect(workspace.getByText('Für PDF übernommen')).toBeVisible({ timeout: 15_000 });
  await expect(workspace.locator('.error[role="alert"]')).toHaveCount(0);
  await workspace.getByLabel('Bezeichnung der Fassung').fill('Mit-Blick');
  await expect(workspace.getByRole('status').first()).toContainText('Vorschau bereit', { timeout: 45_000 });
  expect(errors.filter(message => !/ResizeObserver|AgXToneMapping|401/.test(message))).toEqual([]);
});

test('export retry prepares again and layout edit starts from automatic settings', async ({ page }) => {
  test.setTimeout(90_000);
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'RetryExport',
    venueName: 'RetrySaal',
    sceneName: 'RetrySzene',
  });
  await waitUntilSaved(page);
  let blocked = true;
  await page.route('**/api/workspaces/*/documents', async route => {
    if (route.request().method() === 'POST' && blocked) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fail' }) });
      return;
    }
    await route.continue();
  });
  await revealEditorCommand(page, 'Konstruktionsplan');
  await page.getByRole('button', { name: 'Konstruktionsplan' }).click();
  const workspace = page.getByRole('region', { name: 'Export' });
  await expect(workspace.getByRole('button', { name: 'Erneut versuchen', exact: true })).toBeVisible({ timeout: 15_000 });
  blocked = false;
  await workspace.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(workspace.getByRole('status').first()).toContainText('Vorschau bereit', { timeout: 20_000 });
  await workspace.getByRole('button', { name: 'Layout bearbeiten', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'Grundriss', exact: true })).toBeVisible();
  await expect(workspace.locator('.export-layout-editor')).toBeVisible();
});

test('toolbar download uses the displayed preview after settings change', async ({ page }) => {
  test.setTimeout(90_000);
  await signInToPlans(page);
  await createProduction(page, {
    productionName: 'DownloadBind',
    venueName: 'DownloadSaal',
    sceneName: 'DownloadSzene',
  });
  await waitUntilSaved(page);
  await revealEditorCommand(page, 'Konstruktionsplan');
  await page.getByRole('button', { name: 'Konstruktionsplan' }).click();
  const workspace = page.getByRole('region', { name: 'Export' });
  await workspace.getByLabel('Bezeichnung der Fassung').fill('Issued_A');
  await expect(workspace.getByRole('status').first()).toContainText('Vorschau bereit', { timeout: 20_000 });
  await workspace.getByRole('button', { name: 'PDF erstellen' }).click();
  await workspace.getByText('Frühere Fassungen').click();
  await expect(workspace.getByRole('listitem').filter({ hasText: 'Issued_A' })).toContainText('Fertig');
  await workspace.getByLabel('Bezeichnung der Fassung').fill('Preview_B');
  await expect(workspace.getByRole('status').first()).toContainText('Vorschau bereit', { timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    workspace.locator('.export-preview-toolbar').getByRole('button', { name: 'Herunterladen', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/Preview_B/);
  const bytes = readFileSync(await download.path() as string);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = await pdfWords(bytes);
  expect(text).toContain('Preview_B');
});

test('direct 2D print keeps the actual SVG symbols and text as vectors', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: '2D-Druckprobe', sceneName: 'Originalansicht', venueName: 'Drucksaal' });
  await placeWallAt(page, 2000, 3000);
  const plan = page.getByRole('img', { name: 'Grundriss der Spielstätte' });
  const text = await plan.locator('text').allTextContents();
  const popupPromise = page.waitForEvent('popup');
  await revealEditorCommand(page, '2D-Ansicht drucken / PDF');
  await page.getByRole('button', { name: '2D-Ansicht drucken / PDF' }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading', { name: /2D-Druckprobe/ })).toBeVisible();
  await expect(popup.locator('main svg')).toBeVisible();
  for (const label of text.filter(label => label && label !== '↻')) expect(await popup.locator('main svg').textContent()).toContain(label);
  await expect(popup.locator('.rotation-handle')).toHaveCount(0);
  await popup.getByLabel('Papierformat').selectOption('A3');
  await popup.getByRole('checkbox', { name: 'Raster', exact: true }).uncheck();
  await expect(popup.locator('[data-print-layer="grid"]')).toBeHidden();
  await popup.getByRole('checkbox', { name: 'Bühnenwände', exact: true }).uncheck();
  await expect(popup.locator('[data-print-layer="walls"]')).toBeHidden();
  await expect(plan.locator('[data-print-layer="walls"]')).toBeVisible();
  await popup.getByRole('checkbox', { name: 'Bühnenwände', exact: true }).check();
  await popup.getByText('Einzelne Elemente', { exact: true }).click();
  const wallToggle = popup.getByRole('checkbox', { name: /^Bühnenwände:/ }).first();
  await wallToggle.uncheck();
  await popup.getByRole('checkbox', { name: 'Bühnenwände', exact: true }).uncheck();
  await popup.getByRole('checkbox', { name: 'Bühnenwände', exact: true }).check();
  await expect(popup.locator('[data-print-layer="walls"]')).toBeHidden();
  await wallToggle.check();
  await expect(popup.locator('[data-print-layer="walls"]')).toBeVisible();
  await popup.getByLabel('Drucknotiz', { exact: true }).fill('Zugang freihalten');
  await popup.getByRole('button', { name: 'Notiz platzieren', exact: true }).click();
  await popup.locator('main svg').click({ position: { x: 300, y: 200 } });
  await expect(popup.locator('[data-print-annotation]')).toHaveCount(1);
  await popup.getByRole('button', { name: 'Pfeil zeichnen', exact: true }).click();
  await popup.locator('main svg').click({ position: { x: 200, y: 200 } });
  await popup.locator('main svg').click({ position: { x: 260, y: 260 } });
  await expect(popup.locator('[data-print-annotation]')).toHaveCount(2);
  const pdf = await popup.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
  expect(await pdfWords(pdf)).toContain('8000 mm');
  expect(await pdfWords(pdf)).toContain('Zugang freihalten');
  await popup.screenshot({ path: 'test-results/direct-2d-print.png', fullPage: true });
  const downloadPromise = popup.waitForEvent('download');
  await popup.getByRole('button', { name: 'SVG herunterladen' }).click();
  const download = await downloadPromise;
  const svg = readFileSync(await download.path() as string, 'utf8');
  expect(svg).toContain('<pattern');
  expect(svg).toContain('viewBox=');
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  await popup.getByRole('button', { name: 'Zugang freihalten entfernen', exact: true }).click();
  await popup.getByRole('button', { name: 'Pfeil entfernen', exact: true }).click();
  await expect(popup.locator('[data-print-annotation]')).toHaveCount(0);
  await popup.getByLabel('Papierformat').selectOption('A4');
  await popup.getByLabel('Maßstab').selectOption('25');
  await expect(popup.getByRole('button', { name: 'Drucken / Als PDF speichern' })).toBeDisabled();
  await popup.close();
});
