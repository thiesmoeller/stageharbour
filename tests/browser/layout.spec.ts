import { commitObjectPlacement, openInspector, placeWallAt, commitWallPlacement, placeNamedObjectAt } from '../helpers/inspector.js';
import { test, expect, type Page } from '@playwright/test';
import { pngBytes } from '../helpers/references.js';
import { createProduction, signInToPlans } from '../helpers/plans.js';

async function signIn(page: Page) {
  await signInToPlans(page);
}

async function waitUntilSaved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 15_000 });
}

/** After reload, hash routes may restore the open scene; otherwise open it from the list. */
async function reopenScene(page: Page, sceneHeading: string, listButton: RegExp) {
  await page.reload();
  const editor = page.getByRole('heading', { name: sceneHeading, exact: true });
  const card = page.getByRole('button', { name: listButton });
  const workspace = page.getByRole('region', { name: 'Bühnenbild bearbeiten' });
  // Deep-link restore wins when present; avoid clicking a list card that the hash route will detach.
  try {
    await workspace.waitFor({ state: 'visible', timeout: 8_000 });
    await expect(editor).toBeVisible();
    return;
  } catch {
    /* list view — open from the card */
  }
  await card.click();
  await expect(editor).toBeVisible();
}

async function planToScreen(page: Page, x: number, y: number) {
  await page.locator('.plan-canvas > svg').scrollIntoViewIfNeeded();
  return page.locator('.plan-canvas > svg').evaluate((svg, point) => {
    const ctm = (svg as SVGSVGElement).getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const mapped = new DOMPoint(point.x, -point.y).matrixTransform(ctm);
    return { x: mapped.x, y: mapped.y };
  }, { x, y });
}

test('create a layout, move a panel, undo the move, and reload the saved result', async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  page.setDefaultTimeout(process.env.CI ? 20_000 : 10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await createProduction(page, {
    productionName: 'Beispielproduktion',
    venueName: 'Beispielsaal',
    sceneName: 'Erste Szene',
  });
  await expect(page.getByRole('heading', { name: 'Erste Szene' })).toBeVisible();
  await expect(page.getByText('Beispielproduktion · Beispielsaal')).toBeVisible();
  await expect(page.getByText('↑ Publikum · Blick zur Bühne')).toBeVisible();
  await waitUntilSaved(page);

  await placeWallAt(page);
  const wall = page.locator('[data-testid^="wall-"]');
  await expect(wall).toHaveCount(1);
  await expect(page.getByLabel('Breite (mm)')).toHaveValue('1200');
  await expect(page.getByLabel('Höhe (mm)', { exact: true })).toHaveValue('2400');
  await expect(page.getByLabel('Dicke (mm)')).toHaveValue('28');
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Y (mm)')).toHaveValue('3000');
  await waitUntilSaved(page);

  await page.getByLabel('X (mm)').fill('2500');
  await page.getByLabel('Drehung (°)').fill('35');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('2500');
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('0');
  await waitUntilSaved(page);

  const box = await wall.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 - 40);
  await page.mouse.up();
  await expect(page.getByLabel('X (mm)')).not.toHaveValue('4000');
  const movedX = await page.getByLabel('X (mm)').inputValue();
  const movedY = await page.getByLabel('Y (mm)').inputValue();
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Y (mm)')).toHaveValue('3000');
  await waitUntilSaved(page);

  await reopenScene(page, 'Erste Szene', /Beispielproduktion · Erste Szene/);
  await expect(wall).toHaveCount(1);
  await wall.click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Y (mm)')).toHaveValue('3000');
  await expect(page.getByLabel('X (mm)')).not.toHaveValue(movedX);
  await expect(page.getByLabel('Y (mm)')).not.toHaveValue(movedY);
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Wiederholen' })).toBeDisabled();

  await placeNamedObjectAt(page, 'Stütze hinzufügen');
  const brace = page.locator('[data-testid^="brace-"]');
  await expect(brace).toHaveCount(1);
  await expect(brace).toContainText('40 × 500 mm');
  await expect(brace).toContainText('1200 mm');
  await expect(page.getByLabel('Grundfläche Breite (mm)')).toHaveValue('40');
  await expect(page.getByLabel('Grundfläche Tiefe (mm)')).toHaveValue('500');
  await expect(page.getByLabel('Stützenhöhe (mm)')).toHaveValue('1200');
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByText('keine Stabilitätsempfehlung')).toBeVisible();
  await waitUntilSaved(page);
  await page.getByLabel('X (mm)').fill('2500');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('2500');
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(brace).toHaveCount(0);
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Wiederholen' }).click();
  await expect(brace).toHaveCount(1);
  await waitUntilSaved(page);

  await reopenScene(page, 'Erste Szene', /Beispielproduktion · Erste Szene/);
  await expect(page.locator('[data-testid^="brace-"]')).toHaveCount(1);
  await page.locator('[data-testid^="brace-"]').click();
  await expect(page.getByLabel('X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Grundfläche Breite (mm)')).toHaveValue('40');
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toBeDisabled();

  await page.getByRole('button', { name: 'Spielstätte' }).click();
  await expect(page.getByRole('heading', { name: 'Spielstätte' })).toBeVisible();
  await openInspector(page, 'Umriss');
  await page.getByLabel('Eckpunkt 2 X (mm)').fill('4000');
  await page.getByLabel('Eckpunkt 3 X (mm)').fill('4200');
  await page.getByLabel('Eckpunkt 3 Y (mm)').fill('3500');
  await page.getByLabel('Eckpunkt 4 X (mm)').fill('200');
  await page.getByLabel('Eckpunkt 4 Y (mm)').fill('3200');
  await openInspector(page, 'Vorlage & Maßstab');
  const uploaded = page.waitForResponse(response => response.url().includes('/venue-references') && response.request().method() === 'POST');
  await page.getByLabel('Vorlage hochladen').setInputFiles({
    name: 'grundriss.png', mimeType: 'image/png', buffer: pngBytes(),
  });
  expect((await uploaded).ok()).toBeTruthy();
  await expect(page.getByRole('dialog', { name: 'Vorlage einrichten' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Im Grundriss übernehmen' })).toBeEnabled({ timeout: 15000 });
  await page.getByRole('button', { name: 'Im Grundriss übernehmen' }).click();
  await expect(page.getByRole('dialog', { name: 'Vorlage einrichten' })).toHaveCount(0);
  await openInspector(page, 'Vorlage & Maßstab');
  await page.getByLabel('Punkt A X').fill('0');
  await page.getByLabel('Punkt A Y').fill('0');
  await page.getByLabel('Punkt B X').fill('30');
  await page.getByLabel('Punkt B Y').fill('40');
  await page.getByLabel('Bekannte Strecke (mm)').fill('5000');
  await openInspector(page, 'Vorlage & Maßstab');
  await expect(page.getByText('Maßstab: 100 mm je Vorlagen-Einheit')).toBeVisible();
  await openInspector(page, 'Anschlüsse & Kabelwege');
  await page.getByRole('button', { name: 'Stromanschluss hinzufügen' }).click();
  await page.getByLabel('Anschluss 1 Bezeichnung').fill('Lichtstrom');
  await page.getByLabel('Anschluss 1 X (mm)').fill('2500');
  await page.getByLabel('Anschluss 1 Y (mm)').fill('1800');
  await page.getByLabel('Anschluss 1 Notiz').fill('16A an der Bühnenkante');
  await openInspector(page, 'Anschlüsse & Kabelwege');
  await page.getByRole('button', { name: 'Kabelkorridor hinzufügen' }).click();
  await page.getByLabel('Kabelkorridor 1 Bezeichnung').fill('Seitenbühne');
  await page.getByLabel('Kabelkorridor 1 Punkt 1 X (mm)').fill('0');
  await page.getByLabel('Kabelkorridor 1 Punkt 1 Y (mm)').fill('1200');
  await page.getByLabel('Kabelkorridor 1 Punkt 2 X (mm)').fill('4000');
  await page.getByLabel('Kabelkorridor 1 Punkt 2 Y (mm)').fill('1200');
  await openInspector(page, 'Überbauung');
  await page.getByLabel('Deckenhöhe über Fußboden (mm)').fill('4000');
  await openInspector(page, 'Überbauung');
  await page.getByRole('button', { name: 'Überbauung hinzufügen' }).click();
  await page.getByLabel('Überbauung 1 Bezeichnung').fill('Lüftung');
  await page.getByLabel('Überbauung 1 X (mm)').fill('2500');
  await page.getByLabel('Überbauung 1 Y (mm)').fill('1800');
  await openInspector(page, 'Freihaltezonen');
  await page.locator('.venue-editor .tool-rail').getByRole('button', { name: 'Freihaltezone zeichnen' }).click();
  const venueSvg = page.locator('svg[aria-label="Umriss der Spielstätte"]');
  async function clickVenue(x: number, y: number) {
    const p = await venueSvg.evaluate((element, pt) => {
      const result = new DOMPoint(pt.x, -pt.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
      return { x: result.x, y: result.y };
    }, { x, y });
    await page.mouse.click(p.x, p.y);
  }
  await clickVenue(3500, 2500);
  await clickVenue(5500, 2500);
  await clickVenue(5500, 4000);
  await clickVenue(3550, 2550);
  await expect(page.getByLabel('Freihaltezone 1 Bezeichnung')).toBeVisible();
  await page.getByLabel('Freihaltezone 1 Bezeichnung').fill('Notausgang Ost');
  await page.getByLabel('Freihaltezone 1 Grund').fill('Notausgang');
  const saved = page.waitForResponse(response => /\/scenes\/[^/]+\/venue$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Spielstätte speichern' }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await reopenScene(page, 'Erste Szene', /Beispielproduktion · Erste Szene/);
  await expect(page.locator('.plan-canvas [data-testid^="connection-point-"]')).toHaveCount(1);
  await expect(page.locator('.plan-canvas [data-testid^="connection-point-"]')).toContainText('Lichtstrom');
  await expect(page.locator('.plan-canvas g[data-testid^="cable-corridor-"]')).toHaveCount(1);
  await expect(page.locator('.plan-canvas g[data-testid^="cable-corridor-"]')).toContainText('Seitenbühne');
  await expect(page.locator('.plan-canvas [data-testid^="overhead-box-"]')).toHaveCount(1);
  await expect(page.locator('.plan-canvas [data-testid^="overhead-box-"]')).toContainText('Lüftung');
  await page.getByRole('button', { name: 'Spielstätte' }).click();
  await expect(page.getByLabel('Eckpunkt 3 X (mm)')).toHaveValue('4200');
  await expect(page.getByLabel('Eckpunkt 3 Y (mm)')).toHaveValue('3500');
  await expect(page.getByLabel('Eckpunkt 4 X (mm)')).toHaveValue('200');
  await expect(page.getByLabel('Punkt B X')).toHaveValue('30');
  await expect(page.getByLabel('Bekannte Strecke (mm)')).toHaveValue('5000');
  await openInspector(page, 'Vorlage & Maßstab');
  await expect(page.getByText('Maßstab: 100 mm je Vorlagen-Einheit')).toBeVisible();
  await expect(page.getByLabel('Anschluss 1 Bezeichnung')).toHaveValue('Lichtstrom');
  await expect(page.getByLabel('Anschluss 1 X (mm)')).toHaveValue('2500');
  await expect(page.getByLabel('Anschluss 1 Y (mm)')).toHaveValue('1800');
  await expect(page.getByLabel('Anschluss 1 Notiz')).toHaveValue('16A an der Bühnenkante');
  await expect(page.getByLabel('Anschluss 1 Art')).toHaveValue('power');
  await expect(page.getByLabel('Kabelkorridor 1 Bezeichnung')).toHaveValue('Seitenbühne');
  await expect(page.getByLabel('Kabelkorridor 1 Punkt 2 X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Kabelkorridor 1 Punkt 2 Y (mm)')).toHaveValue('1200');
  await expect(page.getByLabel('Deckenhöhe über Fußboden (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Überbauung 1 Bezeichnung')).toHaveValue('Lüftung');
  await expect(page.getByLabel('Überbauung 1 X (mm)')).toHaveValue('2500');
  await expect(page.getByLabel('Überbauung 1 Y (mm)')).toHaveValue('1800');
  await expect(page.getByLabel('Überbauung 1 Unterkante über Fußboden (mm)')).toHaveValue('2600');
  await expect(page.getByLabel('Freihaltezone 1 Bezeichnung')).toHaveValue('Notausgang Ost');
  await expect(page.getByLabel('Freihaltezone 1 Grund')).toHaveValue('Notausgang');
  await page.getByRole('button', { name: 'Spielstätte schließen' }).click();
  await expect(page.locator('.plan-canvas [data-testid^="keep-clear-zone-"]')).toHaveCount(1);
  await expect(page.locator('.plan-canvas [data-testid^="keep-clear-zone-"]')).toContainText('Notausgang Ost');
  await expect(page.locator('.plan-canvas .warning').filter({ hasText: 'Notausgang Ost' })).toHaveCount(2);
  await expect(page.locator('.plan-canvas .warning').filter({ hasText: 'Notausgang Ost' }).filter({ hasText: 'Wand' })).toBeVisible();
  await expect(page.locator('.plan-canvas .warning').filter({ hasText: 'Notausgang Ost' }).filter({ hasText: 'Stütze' })).toBeVisible();
  await openInspector(page, 'Platzhalter');
  await placeNamedObjectAt(page, 'Tisch hinzufügen');
  await expect(page.locator('.plan-canvas [data-testid^="placeholder-"]')).toHaveCount(1);
  await expect(page.locator('#placeholder-depth')).toHaveValue('800');
  await expect(page.locator('#placeholder-height')).toHaveValue('750');
  await page.locator('#placeholder-x').fill('4000');
  await page.locator('#placeholder-y').fill('3000');
  await page.locator('#placeholder-depth').fill('900');
  await page.locator('#placeholder-depth').locator('xpath=ancestor::form').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('#placeholder-depth')).toHaveValue('900');
  await waitUntilSaved(page);
  await expect(page.locator('.plan-canvas .warning').filter({ hasText: 'Notausgang Ost' }).filter({ hasText: 'Tisch' })).toBeVisible();
  await page.screenshot({ path: 'test-results/layout-editor.png', fullPage: true });

  await placeWallAt(page, 5000, 3000);
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(2);
  await openInspector(page, 'Platteninventar');
  await page.getByRole('button', { name: 'Bestand bearbeiten' }).click();
  await page.getByLabel('Plattenetikett').fill('Beispiel-P01');
  await page.getByRole('button', { name: 'Platte anlegen' }).click();
  await expect(page.getByText('Beispiel-P01 · Glattwand')).toBeVisible();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await openInspector(page, 'Platteninventar');
  await page.getByLabel('Platte zuweisen').selectOption({ label: 'Beispiel-P01' });
  await expect(page.getByTestId('inventory-warnings')).toContainText('keine Platte zugewiesen');
  await expect(page.getByTestId('inventory-warnings')).toContainText('Bestand reicht nicht');
  await waitUntilSaved(page);
  await reopenScene(page, 'Erste Szene', /Beispielproduktion · Erste Szene/);
  await expect(page.getByRole('heading', { name: 'Erste Szene' })).toBeVisible();
  await expect(page.locator('.plan-canvas [data-testid^="placeholder-"]')).toHaveCount(1);
  await page.locator('.plan-canvas [data-testid^="placeholder-"]').click();
  await expect(page.locator('#placeholder-depth')).toHaveValue('900');
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await openInspector(page, 'Platteninventar');
  await expect(page.getByText('Zugewiesen: Beispiel-P01')).toBeVisible();
  await expect(page.getByTestId('inventory-warnings')).toContainText('keine Platte zugewiesen');
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await page.getByLabel('X (mm)').fill('1500');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await waitUntilSaved(page);
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '2. Wand' });
  await page.getByLabel('X (mm)').fill('5500');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await waitUntilSaved(page);
  await expect(page.getByText('V Vorderseite · R Rückseite')).toBeVisible();
  await openInspector(page, 'Aufbau & Verbindungen');
  await expect(page.getByText('Verbindungskompatibilität prüft die Crew manuell')).toBeVisible();
  await page.getByRole('button', { name: 'Montagenummern vergeben' }).click();
  await waitUntilSaved(page);
  await expect(page.locator('[data-testid^="assembly-label-"]')).toHaveText([
    'Position 1 · Platte Beispiel-P01', 'Position 2',
  ]);
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  const assembledX = await page.getByLabel('X (mm)').inputValue();
  await page.getByLabel('Verbinden mit').selectOption({ label: 'Position 2' });
  await page.getByRole('button', { name: 'Verbindung eintragen' }).click();
  await expect(page.getByTestId('assembly-connections')).toContainText('Position 1 – Position 2');
  await expect(page.getByLabel('X (mm)')).toHaveValue(assembledX);
  await page.getByLabel('Rigginghinweise').fill('Stifte belassen.');
  await page.getByRole('button', { name: 'Hinweise speichern' }).click();
  await waitUntilSaved(page);
  await reopenScene(page, 'Erste Szene', /Beispielproduktion · Erste Szene/);
  await expect(page.getByText('Position 1 · Platte Beispiel-P01')).toBeVisible();
  await expect(page.getByTestId('assembly-connections')).toContainText('Position 1 – Position 2');
  await openInspector(page, 'Aufbau & Verbindungen');
  await expect(page.getByLabel('Rigginghinweise')).toHaveValue('Stifte belassen.');
  await openInspector(page, 'Gruppieren');
  await expect(page.getByRole('button', { name: 'Gruppieren' })).toBeDisabled();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await page.locator('[data-testid^="wall-"]').nth(1).click({ modifiers: ['Shift'] });
  await openInspector(page, 'Gruppieren');
  await expect(page.getByRole('button', { name: 'Gruppieren' })).toBeEnabled();
  await openInspector(page, 'Gruppieren');
  await page.getByRole('button', { name: 'Gruppieren' }).click();
  await openInspector(page, 'Gruppieren');
  await expect(page.getByLabel('Drehpunkt X (mm)')).toHaveValue('3500');
  await expect(page.getByLabel('Gruppendrehung (°)')).toHaveValue('0');
  await waitUntilSaved(page);
  await page.getByLabel('Drehpunkt X (mm)').fill('3900');
  await page.getByLabel('Gruppendrehung (°)').fill('180');
  await page.locator('.group-panel').getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('5900');
  await expect(page.getByLabel('Drehung (°)', { exact: true })).toHaveValue('180');
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '2. Wand' });
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('1900');
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('1500');
  await expect(page.getByLabel('Drehung (°)', { exact: true })).toHaveValue('0');
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '2. Wand' });
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('5500');
  await openInspector(page, 'Gruppieren');
  await expect(page.getByLabel('Drehpunkt X (mm)')).toHaveValue('3500');
  await waitUntilSaved(page);
  await reopenScene(page, 'Erste Szene', /Beispielproduktion · Erste Szene/);
  await expect(page.getByRole('heading', { name: 'Erste Szene' })).toBeVisible();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await openInspector(page, 'Gruppieren');
  await expect(page.getByLabel('Drehpunkt X (mm)')).toHaveValue('3500');
  await openInspector(page, 'Gruppieren');
  await expect(page.getByRole('button', { name: 'Gruppe auflösen' })).toBeVisible();
  await page.getByLabel('X (mm)', { exact: true }).fill('1800');
  await page.locator('#wall-x').locator('xpath=ancestor::form').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('1800');
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '2. Wand' });
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('5500');
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  // Selecting a group member selects its whole group; Shift would deselect the second wall.
  await expect(page.getByRole('heading', { name: '2 Wandelemente', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kopieren' }).click();
  await page.getByRole('button', { name: 'Einfügen' }).click();
  // Group pivot is (3650, 3000); place 300 mm audience-right so wall 3 lands at x=2100.
  await commitObjectPlacement(page, 3950, 3000, { bypassSnap: true });
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(4);
  await waitUntilSaved(page);
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '3. Wand' });
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('2100');
  await openInspector(page, 'Platteninventar');
  await expect(page.getByLabel('Platte zuweisen')).toHaveValue('');
  await expect(page.getByText('Zugewiesen: Beispiel-P01')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(2);
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await openInspector(page, 'Platteninventar');
  await expect(page.getByText('Zugewiesen: Beispiel-P01')).toBeVisible();
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('1800');
  await page.getByLabel('X (mm)', { exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(2);
  // Paste into a focused inspector field marks pending Übernehmen state without placing walls.
  const discard = page.getByRole('button', { name: 'Verwerfen', exact: true });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  const duplicated = page.waitForResponse(response => response.url().includes('/duplicate') && response.request().method() === 'POST');
  await page.locator('.scene-card').filter({ has: page.getByRole('button', { name: /Beispielproduktion · Erste Szene Beispielsaal/ }) }).getByRole('button', { name: 'Szene duplizieren', exact: true }).click();
  expect((await duplicated).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: /Erste Szene \(Kopie\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Beispielproduktion · Erste Szene Beispielsaal/ })).toBeVisible();
  await page.getByRole('button', { name: /Erste Szene \(Kopie\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Erste Szene (Kopie)' })).toBeVisible();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await openInspector(page, 'Platteninventar');
  await expect(page.getByText('Zugewiesen: Beispiel-P01')).toBeVisible();
  await page.getByLabel('X (mm)', { exact: true }).fill('2200');
  await page.locator('#wall-x').locator('xpath=ancestor::form').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('2200');
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await reopenScene(page, 'Erste Szene', /Beispielproduktion · Erste Szene Beispielsaal/);
  await expect(page.getByRole('heading', { name: 'Erste Szene', exact: true })).toBeVisible();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('1800');
  await openInspector(page, 'Platteninventar');
  await expect(page.getByText('Zugewiesen: Beispiel-P01')).toBeVisible();

  await openInspector(page, 'Gruppieren');
  await page.getByRole('button', { name: 'Gruppe auflösen' }).click();
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Spielstätte' }).click();
  await openInspector(page, 'Bühnenmittellinie');
  await page.getByLabel('Mittellinie X (mm)').fill('4000');
  await page.getByLabel('Mittellinie Y (mm)').fill('2500');
  await page.getByLabel('Mittellinie Drehung (°)').fill('90');
  await expect(page.getByLabel('Mittellinie Drehung (°)')).toHaveValue('90');
  await page.getByLabel('Mittellinie Drehung (°)').blur();
  await expect(page.getByRole('button', { name: 'Spielstätte schließen' })).toBeDisabled();
  const savedCentreline = page.waitForResponse(
    response => /\/scenes\/[^/]+\/venue$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT',
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Spielstätte speichern' }).click({ force: true });
  expect((await savedCentreline).ok()).toBeTruthy();
  await expect(page.getByText('Spielstättenfassung gespeichert', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Spielstätte schließen' })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Spielstätte schließen' }).click({ force: true });
  await expect(page.getByTestId('stage-centreline')).toBeVisible();
  await expect(page.getByText('Einrasten', { exact: true })).toBeVisible();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  // Keep this snap probe clear of the brace/table assembled earlier in the journey.
  await page.locator('#wall-y').fill('1000');
  await page.getByLabel('X (mm)', { exact: true }).fill('2500');
  await page.locator('#wall-x').locator('xpath=ancestor::form').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('2500');
  await waitUntilSaved(page);
  const wallY = Number(await page.getByLabel('Y (mm)', { exact: true }).inputValue());
  const nearCentre = await planToScreen(page, 3550, wallY);
  const dragStart = await planToScreen(page, 2000, wallY);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(nearCentre.x, nearCentre.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByLabel('X (mm)', { exact: true })).toHaveValue('4000');
  // Alt bypass is covered with isolated wall geometry in interactions.spec.ts.
  await waitUntilSaved(page);
  await reopenScene(page, 'Erste Szene', /Beispielproduktion · Erste Szene Beispielsaal/);
  await expect(page.getByRole('heading', { name: 'Erste Szene' })).toBeVisible();
  await expect(page.getByTestId('stage-centreline')).toBeVisible();
  await page.getByRole('button', { name: 'Spielstätte' }).click();
  await expect(page.getByLabel('Mittellinie X (mm)')).toHaveValue('4000');
  await expect(page.getByLabel('Mittellinie Y (mm)')).toHaveValue('2500');
  await expect(page.getByLabel('Mittellinie Drehung (°)')).toHaveValue('90');

  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  await createProduction(page, {
    productionName: 'Gastspiel',
    venueName: 'Stadthalle',
    sceneName: 'Gastszene',
  });
  await expect(page.getByRole('heading', { name: 'Gastszene' })).toBeVisible();
  await waitUntilSaved(page);
  await page.getByRole('button', { name: 'Spielstätte' }).click();
  await openInspector(page, 'Freihaltezonen');
  await page.locator('.venue-editor .tool-rail').getByRole('button', { name: 'Freihaltezone zeichnen' }).click();
  {
    const venueSvg = page.locator('svg[aria-label="Umriss der Spielstätte"]');
    async function clickVenue(x: number, y: number) {
      const p = await venueSvg.evaluate((element, pt) => {
        const result = new DOMPoint(pt.x, -pt.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
        return { x: result.x, y: result.y };
      }, { x, y });
      await page.mouse.click(p.x, p.y);
    }
    await clickVenue(1000, 1000);
    await clickVenue(2500, 1000);
    await clickVenue(2500, 2000);
    await clickVenue(1050, 1050);
  }
  await page.getByLabel('Freihaltezone 1 Bezeichnung').fill('Notausgang Ost');
  await openInspector(page, 'Überbauung');
  await page.getByRole('button', { name: 'Überbauung hinzufügen' }).click();
  await page.getByLabel('Überbauung 1 Bezeichnung').fill('Lüftung');
  await openInspector(page, 'Überbauung');
  await page.getByLabel('Deckenhöhe über Fußboden (mm)').fill('2000');
  const savedGuestVenue = page.waitForResponse(response => /\/scenes\/[^/]+\/venue$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Spielstätte speichern' }).click();
  expect((await savedGuestVenue).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Spielstätte schließen' }).click();
  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  const copiedAcross = page.waitForResponse(response => response.url().includes('/copy') && response.request().method() === 'POST');
  const sourceCard = page.getByRole('button', { name: /Beispielproduktion · Erste Szene Beispielsaal/ })
    .locator('xpath=ancestor::div[contains(@class,"scene-card")]');
  await sourceCard.locator('summary', { hasText: 'Weitere Aktionen' }).click();
  await sourceCard.getByRole('button', { name: 'In andere Spielstätte kopieren' }).click();
  await page.getByLabel('Zielproduktion').selectOption({ label: 'Gastspiel' });
  await page.getByLabel('Zielspielstätte').selectOption({ label: 'Stadthalle' });
  await page.getByRole('button', { name: 'Als Spielstättenanpassung anlegen' }).click();
  expect((await copiedAcross).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: /Gastspiel · Erste Szene \(Kopie\)/ })).toBeVisible();
  await page.getByRole('button', { name: /Gastspiel · Erste Szene \(Kopie\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Erste Szene (Kopie)' })).toBeVisible();
  await expect(page.getByText('Gastspiel · Stadthalle')).toBeVisible();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await expect(page.getByText('Zugewiesen: Beispiel-P01')).toHaveCount(0);
  await openInspector(page, 'Platteninventar');
  await expect(page.getByLabel('Platte zuweisen')).toHaveValue('');
  await expect(page.getByTestId('overhead-warning').first()).toContainText('Deckenhöhe');
  await expect(page.getByLabel('Freihaltezonen')).toBeVisible();

  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  const capturedTemplate = page.waitForResponse(response => /\/scenes\/[^/]+\/templates$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  const templateSource = page.getByRole('button', { name: /Beispielproduktion · Erste Szene Beispielsaal/ })
    .locator('xpath=ancestor::div[contains(@class,"scene-card")]');
  await templateSource.locator('summary', { hasText: 'Weitere Aktionen' }).click();
  await templateSource.getByRole('button', { name: 'Als Szenenvorlage speichern' }).click();
  await page.getByLabel('Name der Szenenvorlage').fill('Grundriss A');
  await page.getByRole('button', { name: 'Szenenvorlage speichern', exact: true }).click();
  expect((await capturedTemplate).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Szenenvorlagen' })).toBeVisible();
  await expect(page.getByText('Grundriss A', { exact: true })).toBeVisible();
  const insertedTemplate = page.waitForResponse(response => response.url().includes('/instantiate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'In Produktion einfügen' }).click();
  await page.getByLabel('Zielproduktion').selectOption({ label: 'Gastspiel' });
  await page.getByLabel('Zielspielstätte').selectOption({ label: 'Stadthalle' });
  await page.getByRole('button', { name: 'Szenenvorlage einfügen' }).click();
  expect((await insertedTemplate).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: /Gastspiel · Grundriss A/ })).toBeVisible();
  await page.getByRole('button', { name: /Gastspiel · Grundriss A/ }).click();
  await expect(page.getByRole('heading', { name: 'Grundriss A' })).toBeVisible();
  await expect(page.getByText('Gastspiel · Stadthalle')).toBeVisible();
  await page.getByLabel('Auswahl', { exact: true }).selectOption({ label: '1. Wand' });
  await expect(page.getByText('Zugewiesen: Beispiel-P01')).toHaveCount(0);
  await openInspector(page, 'Platteninventar');
  await expect(page.getByLabel('Platte zuweisen')).toHaveValue('');

  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  const copiedReturn = page.waitForResponse(response => response.url().includes('/copy') && response.request().method() === 'POST');
  const returnSource = page.getByRole('button', { name: /Beispielproduktion · Erste Szene Beispielsaal/ })
    .locator('xpath=ancestor::div[contains(@class,"scene-card")]');
  await returnSource.locator('summary', { hasText: 'Weitere Aktionen' }).click();
  await returnSource.getByRole('button', { name: 'In andere Spielstätte kopieren' }).click();
  await page.getByLabel('Zielproduktion').selectOption({ label: 'Gastspiel' });
  await page.getByLabel('Zielspielstätte').selectOption({ label: 'Beispielsaal' });
  await page.getByRole('textbox', { name: 'Szene' }).fill('Rückkehr');
  await page.getByRole('button', { name: 'Als Spielstättenanpassung anlegen' }).click();
  expect((await copiedReturn).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: /Gastspiel · Rückkehr/ })).toBeVisible();
  await page.getByRole('button', { name: /Beispielproduktion · Erste Szene Beispielsaal/ }).click();
  await expect(page.getByRole('heading', { name: 'Erste Szene', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Spielstätte' }).click();
  await openInspector(page, 'Überbauung');
  await page.getByLabel('Deckenhöhe über Fußboden (mm)').fill('1800');
  const savedCeiling = page.waitForResponse(response => /\/scenes\/[^/]+\/venue$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Spielstätte speichern' }).click();
  expect((await savedCeiling).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Produktionen & Szenen' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Gastspiel · Rückkehr/ })).toContainText('Aktualisierung verfügbar');
  await expect(page.getByRole('button', { name: /Beispielproduktion · Erste Szene Beispielsaal/ })).not.toContainText('Aktualisierung verfügbar');
  const appliedVenue = page.waitForResponse(response => response.url().includes('/venue-apply') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Gastspiel · Rückkehr/ })
    .locator('xpath=ancestor::div[contains(@class,"scene-card")]')
    .getByRole('button', { name: 'Spielstättenfassung übernehmen' }).click();
  expect((await appliedVenue).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: /Gastspiel · Rückkehr/ })).not.toContainText('Aktualisierung verfügbar');
  await page.getByRole('button', { name: /Gastspiel · Rückkehr/ }).click();
  await expect(page.getByRole('heading', { name: 'Rückkehr' })).toBeVisible();
  await expect(page.getByTestId('overhead-warning').first()).toContainText('1800');
  expect(errors).toEqual([]);
});

test('create a wall type with a rectangular opening, place it, and export the plan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await createProduction(page, {
    productionName: 'Türproduktion',
    venueName: 'Türsaal',
    sceneName: 'Türszene',
  });
  await expect(page.getByRole('heading', { name: 'Türszene' })).toBeVisible();
  await waitUntilSaved(page);

  await openInspector(page, 'Wandtypen');
  await page.getByRole('button', { name: 'Wandtyp anlegen' }).click();
  await page.getByLabel('Wandtyp-Bezeichnung').fill('Türwand');
  await page.getByRole('button', { name: 'Öffnung hinzufügen', exact: true }).click();
  await expect(page.getByLabel('Öffnungsbreite (mm)')).toHaveValue('800');
  await page.getByLabel('Öffnungsbreite (mm)').fill('2000');
  await page.getByRole('button', { name: 'Wandtyp speichern' }).click();
  await expect(page.getByRole('alert')).toContainText('innerhalb der Platte');
  await page.getByLabel('Öffnungsbreite (mm)').fill('800');
  await page.getByRole('button', { name: 'Wandtyp speichern' }).click();
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Wandtyp platzieren' }).click();
  await commitWallPlacement(page);
  await expect(page.locator('[data-testid^="wall-"]')).toHaveCount(1);
  const opening = page.locator('[data-testid^="plan-opening-"]');
  await expect(opening).toHaveCount(1);
  await expect(opening).toHaveAttribute('data-width', '800');
  await expect(opening).toHaveAttribute('data-height', '2000');
  await expect(opening).toHaveAttribute('data-left', '200');
  const stageWall = page.locator('[data-testid^="stage-wall-"]');
  await expect(stageWall).toHaveAttribute('data-opening-count', '1');
  await expect(stageWall).toHaveAttribute('data-opening-width', '800');
  await expect(stageWall).toHaveAttribute('data-opening-height', '2000');
  await expect(stageWall).toHaveAttribute('data-width', '1200');
  await expect(stageWall).toHaveAttribute('data-height', '2400');
  await waitUntilSaved(page);

  await page.getByRole('button', { name: 'Konstruktionsplan' }).click();
  await page.getByLabel('Bezeichnung der Fassung').fill('Türfassung');
  await page.getByRole('button', { name: 'Als Konstruktionsplan exportieren' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Türfassung' })).toContainText('Fertig');
  expect(errors).toEqual([]);
});

test('a failed autosave keeps the local draft and retries the same revision', async ({ page }) => {
  await signIn(page);
  await createProduction(page, {
    productionName: 'Netzwerkprobe',
    venueName: 'Probesaal',
  });
  await expect(page.getByRole('heading', { name: 'Szene 1' })).toBeVisible();
  await waitUntilSaved(page);

  await page.route('**/api/workspaces/**/scenes/**/layout', route => route.abort());
  await placeWallAt(page);
  await expect(page.getByRole('alert')).toContainText('noch nicht gespeichert');
  await expect(page.locator('.save-status')).toHaveText('Speichern fehlgeschlagen');
  await page.unroute('**/api/workspaces/**/scenes/**/layout');
  await page.getByRole('button', { name: 'Speichern erneut versuchen' }).click();
  await waitUntilSaved(page);
  await expect(page.locator('.plan-canvas g[data-testid^="wall-"]')).toHaveCount(1);
  await reopenScene(page, 'Szene 1', /Netzwerkprobe · Szene 1/);
  await expect(page.locator('.plan-canvas g[data-testid^="wall-"]')).toHaveCount(1);
});
