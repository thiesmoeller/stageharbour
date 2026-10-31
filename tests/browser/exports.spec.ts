import { test, expect } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { placeWallAt } from '../helpers/inspector.js';

async function pdfText(bytes: Buffer) {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
    const page = await pdf.getPage(index + 1);
    const content = await page.getTextContent();
    return content.items.map(item => 'str' in item ? item.str : '').join(' ');
  }));
  return { pages, text: pages.join(' ') };
}

test('technical recipient PDF uses the deterministic server renderer and named sections', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Serverdokument', venueName: 'Saal', sceneName: 'Aufbau' });
  await placeWallAt(page, 2500, 3000);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await revealEditorCommand(page, 'PDF gestalten');
  await page.getByRole('button', { name: 'PDF gestalten' }).click();
  const workspace = page.getByRole('dialog', { name: 'Dokument erstellen' });
  await workspace.getByLabel('Bezeichnung der Fassung').fill('Technikfassung');
  await workspace.getByText('Einleitung und Kontakt', { exact: true }).click();
  await workspace.getByLabel('Einleitung', { exact: true }).fill('Aufbauhinweise für die Crew.');
  await workspace.getByRole('button', { name: 'Druckvorschau', exact: true }).click();
  const frame = workspace.getByTitle('PDF-Vorschau');
  await expect(frame).toBeVisible({ timeout: 30_000 });
  const src = await frame.getAttribute('src');
  if (!src) throw new Error('Preview URL missing');
  const bytes = Buffer.from(await page.evaluate(async url =>
    [...new Uint8Array(await (await fetch(url)).arrayBuffer())], src));
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const parsed = await pdfText(bytes);
  expect(parsed.text).toContain('Aufbau / Technik');
  expect(parsed.text).toContain('Technikfassung');
  expect(parsed.text).toContain('Aufbauhinweise für die Crew');
  expect(parsed.text).toContain('Grundriss');
  expect(parsed.text).toContain('Stückliste');
});

test('performer PDF omits construction schedules', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Spielplan', venueName: 'Saal', sceneName: 'Abend' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await revealEditorCommand(page, 'PDF gestalten');
  await page.getByRole('button', { name: 'PDF gestalten' }).click();
  const workspace = page.getByRole('dialog', { name: 'Dokument erstellen' });
  await workspace.getByRole('button', { name: /Darstellende/ }).click();
  await workspace.getByRole('button', { name: 'Inhalt', exact: true }).click();
  await workspace.getByRole('checkbox', { name: 'Raumsichten' }).uncheck();
  await workspace.getByRole('button', { name: 'Druckvorschau', exact: true }).click();
  const frame = workspace.getByTitle('PDF-Vorschau');
  await expect(frame).toBeVisible({ timeout: 30_000 });
  const src = await frame.getAttribute('src');
  if (!src) throw new Error('Preview URL missing');
  const bytes = Buffer.from(await page.evaluate(async url =>
    [...new Uint8Array(await (await fetch(url)).arrayBuffer())], src));
  const parsed = await pdfText(bytes);
  expect(parsed.text).toContain('Darstellende');
  expect(parsed.text).toContain('Übersicht');
  expect(parsed.text).not.toContain('Stückliste');
  expect(parsed.text).not.toContain('Kabelliste');
});
