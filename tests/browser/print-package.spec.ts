import { test, expect } from '@playwright/test';
import { createProduction, signInToPlans } from '../helpers/plans.js';
import { revealEditorCommand } from '../helpers/editorMenus.js';

async function openDocuments(page: import('@playwright/test').Page) {
  await revealEditorCommand(page, 'PDF gestalten');
  await page.getByRole('button', { name: 'PDF gestalten' }).click();
  return page.getByRole('region', { name: 'Dokument erstellen' });
}

test('new users choose a recipient, review named contents, preview, issue, and restore the saved draft', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Dokumentfluss', venueName: 'Probensaal', sceneName: 'Probe' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  const workspace = await openDocuments(page);
  await expect(page.getByRole('toolbar', { name: 'Objekte hinzufügen' })).toBeHidden();
  const bounds = await workspace.boundingBox();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await expect(workspace.getByRole('button', { name: /Regie \/ Probe/ })).toBeVisible();
  await expect(workspace.getByRole('button', { name: /Regie \/ Probe/ })).toHaveCSS('color', 'rgb(32, 60, 54)');
  await expect(workspace.getByRole('button', { name: /Darstellende/ })).toBeVisible();
  await workspace.getByRole('button', { name: /Aufbau \/ Technik/ }).click();
  await expect(workspace.getByRole('heading', { name: 'Aufbau / Technik' })).toBeVisible();
  await expect(workspace).toContainText('Noch keine tatsächlichen Kabelwege geplant');
  await workspace.getByRole('button', { name: 'Empfänger ändern' }).click();
  await expect(workspace.getByRole('heading', { name: 'Für wen ist das Dokument?' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: /Aufbau \/ Technik/ })).toHaveAttribute('aria-pressed', 'true');
  await workspace.getByRole('button', { name: /Aufbau \/ Technik/ }).click();
  await workspace.getByRole('button', { name: 'Weiter zum Inhalt' }).click();
  await expect(workspace.getByRole('checkbox', { name: 'Kabelliste' })).toBeChecked();
  await workspace.getByLabel('Bezeichnung der Fassung').fill('Aufbaufassung');
  await workspace.getByLabel('Einleitung').fill('Aufbau am Vortag.');
  await workspace.getByRole('button', { name: 'Entwurf speichern' }).click();
  await expect(workspace.getByRole('button', { name: 'Entwurf gespeichert' })).toBeVisible();
  await workspace.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await expect(workspace.getByTitle('PDF-Vorschau')).toBeVisible({ timeout: 30_000 });
  await expect(workspace).toContainText(/Blatt bereit/);
  await workspace.getByRole('button', { name: 'PDF erstellen' }).click();
  await expect(workspace.getByRole('button', { name: 'PDF erstellt' })).toBeVisible();
  await workspace.getByRole('button', { name: 'Zurück zum Editor' }).click();
  await expect(page.getByRole('toolbar', { name: 'Objekte hinzufügen' })).toBeVisible();
  const reopened = await openDocuments(page);
  await expect(reopened.getByRole('heading', { name: 'Aufbau / Technik' })).toBeVisible();
  await reopened.getByRole('button', { name: '2. Inhalt', exact: true }).click();
  await expect(reopened.getByLabel('Bezeichnung der Fassung')).toHaveValue('Aufbaufassung');
  await expect(reopened.getByLabel('Einleitung')).toHaveValue('Aufbau am Vortag.');
});

test('an actual tech-stand cable run is editable and clears the technical readiness warning', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Kabelprobe', venueName: 'Kabelsaal', sceneName: 'Aufbau' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Kabel zeichnen' }).click();
  const plan = page.getByRole('img', { name: 'Grundriss der Spielstätte' });
  const box = await plan.boundingBox();
  if (!box) throw new Error('Plan not visible');
  await plan.click({ position: { x: box.width * 0.18, y: box.height * 0.7 } });
  await plan.click({ position: { x: box.width * 0.42, y: box.height * 0.35 } });
  const panel = page.getByRole('complementary', { name: 'Tatsächliche Kabelwege' });
  await expect(panel).toContainText('benötigt');
  await panel.getByLabel('Kabeltyp').fill('Schuko 16 A');
  await panel.getByLabel('Anzahl').fill('3');
  await panel.getByLabel('Von').fill('Technikstand FOH');
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  await panel.getByRole('button', { name: 'Schließen' }).click();
  const workspace = await openDocuments(page);
  await workspace.getByRole('button', { name: /Aufbau \/ Technik/ }).click();
  await expect(workspace).not.toContainText('Noch keine tatsächlichen Kabelwege geplant');
  await workspace.getByRole('button', { name: 'Weiter zum Inhalt' }).click();
  await workspace.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await expect(workspace.getByTitle('PDF-Vorschau')).toBeVisible({ timeout: 30_000 });
});

test('performer preset is explicitly a reduced orientation handout', async ({ page }) => {
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Orientierung', venueName: 'Saal', sceneName: 'Szene' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  const workspace = await openDocuments(page);
  await workspace.getByRole('button', { name: /Darstellende/ }).click();
  await workspace.getByRole('button', { name: 'Weiter zum Inhalt' }).click();
  await expect(workspace.getByRole('checkbox', { name: 'Orientierungsplan' })).toBeChecked();
  await expect(workspace.getByRole('checkbox', { name: 'Bemaßter Grundriss' })).not.toBeChecked();
  await expect(workspace.getByRole('checkbox', { name: 'Kabelliste' })).not.toBeChecked();
});

test('document contents and preview stay inside the editor viewport and scroll to their end', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signInToPlans(page);
  await createProduction(page, { productionName: 'Scrollprobe', venueName: 'Saal', sceneName: 'Szene' });
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  const workspace = await openDocuments(page);
  await workspace.getByRole('button', { name: /Aufbau \/ Technik/ }).click();
  await workspace.getByRole('button', { name: 'Weiter zum Inhalt' }).click();
  const geometry = await workspace.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: rect.top, bottom: rect.bottom, viewport: innerHeight,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: style.overflowY,
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(['auto', 'scroll']).toContain(geometry.overflowY);
  await workspace.evaluate(element => element.scrollTo({ top: element.scrollHeight }));
  expect(await workspace.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await workspace.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await expect(workspace.getByTitle('PDF-Vorschau')).toBeVisible({ timeout: 30_000 });
  const previewGeometry = await workspace.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom, viewport: innerHeight,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
    };
  });
  expect(previewGeometry.bottom).toBeLessThanOrEqual(previewGeometry.viewport);
  expect(previewGeometry.scrollHeight).toBeGreaterThan(previewGeometry.clientHeight);
  await workspace.evaluate(element => element.scrollTo({ top: element.scrollHeight }));
  expect(await workspace.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});
