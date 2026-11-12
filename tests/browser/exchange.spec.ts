import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { revealEditorCommand } from '../helpers/editorMenus.js';
import { placeWallAt } from '../helpers/inspector.js';

test('Datei menu downloads the Bühnenbild as glTF and as MVR', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Austausch', venueName: 'Aula', sceneName: 'Erster Akt' });
  await placeWallAt(page, 2500, 3000);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');

  await revealEditorCommand(page, 'Export als glTF (.glb)');
  const glbDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export als glTF (.glb)', exact: true }).click();
  const glb = await glbDownload;
  expect(glb.suggestedFilename()).toBe('Erster_Akt.glb');
  const glbPath = (await glb.path())!;
  const glbBytes = readFileSync(glbPath);
  expect(glbBytes.subarray(0, 4).toString('latin1')).toBe('glTF');

  await revealEditorCommand(page, 'Export als MVR');
  const mvrDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export als MVR', exact: true }).click();
  const mvr = await mvrDownload;
  expect(mvr.suggestedFilename()).toBe('Erster_Akt.mvr');
  const mvrBytes = readFileSync((await mvr.path())!);
  expect(mvrBytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(mvrBytes.includes(Buffer.from('GeneralSceneDescription.xml'))).toBe(true);
});
