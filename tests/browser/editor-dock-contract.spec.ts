import { test, expect } from '@playwright/test';
import { bounds, dockPanels, enterVenue, expectActiveDock, expectNoPageOverflow, openEditorShell } from '../helpers/editorShell.js';
import { commitWallPlacement } from '../helpers/inspector.js';

for (const kind of ['stage', 'venue'] as const) {
  test(`${kind} dock exposes exactly one pane and excludes hidden inputs from keyboard navigation`, async ({ page }) => {
    await openEditorShell(page, kind, `${kind} exclusive dock`);
    await expectActiveDock(page, null);
    for (const name of dockPanels) {
      await page.getByRole('button', { name, exact: true }).click();
      await expectActiveDock(page, name);
    }
    const names = page.getByRole('checkbox', { name: 'Namen', exact: true });
    await names.focus();
    await page.keyboard.press('Space');
    await expect(names).not.toBeChecked();
    // The properties and library panes have already mounted. Tab must stay in
    // the displayed pane and skip their controls.
    for (const name of ['Maße', 'Texte', 'Traversen', 'Scheinwerfer']) {
      await page.keyboard.press('Tab');
      await expect(page.getByRole('checkbox', { name, exact: true })).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Eigenschaften', exact: true })).toBeFocused();
    await names.focus();
    await page.keyboard.press('Escape');
    await expectActiveDock(page, null);
    await expect(page.getByRole('button', { name: 'Anzeige', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expectActiveDock(page, 'Anzeige');
    await expect(names).not.toBeChecked();
    // Activating the same rail control collapses the dock too.
    await page.keyboard.press('Enter');
    await expectActiveDock(page, null);
  });

  test(`${kind} unpinned placement closes the library, pinned placement keeps it, and both choices reload`, async ({ page }) => {
    await openEditorShell(page, kind, `${kind} pin behavior`);
    const library = page.getByRole('region', { name: 'Bibliothek', exact: true });
    await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
    if (kind === 'stage') await library.getByRole('button', { name: 'Wandtypen', exact: true }).click();
    await library.getByRole('button', { name: 'Wandtyp anlegen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Seitenleiste anheften' })).toHaveAttribute('aria-pressed', 'false');
    await library.getByRole('button', { name: 'Wandtyp platzieren', exact: true }).click();
    await expectActiveDock(page, null);
    await page.getByRole('button', { name: kind === 'stage' ? 'Auswahl' : 'Auswählen', exact: true }).click();
    await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
    await page.getByRole('button', { name: 'Seitenleiste anheften' }).click();
    await library.getByRole('button', { name: 'Wandtyp platzieren', exact: true }).click();
    await expectActiveDock(page, 'Bibliothek');
    await page.getByRole('button', { name: kind === 'stage' ? 'Auswahl' : 'Auswählen', exact: true }).click();
    if (kind === 'venue') await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.locator('.save-status:visible')).toHaveText(kind === 'stage' ? 'Gespeichert' : 'Spielstättenfassung gespeichert');
    // Nested venue editing returns to the stage after reload; explicitly reopen it.
    await page.reload();
    if (kind === 'venue') await enterVenue(page);
    await expectActiveDock(page, 'Bibliothek');
    await expect(page.getByRole('button', { name: 'Seitenleiste anheften' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Seitenleiste anheften' }).click();
    await page.getByRole('button', { name: 'Seitenleiste schließen' }).click();
    await page.reload();
    if (kind === 'venue') await enterVenue(page);
    await expectActiveDock(page, null);
    await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Seitenleiste anheften' })).toHaveAttribute('aria-pressed', 'false');
  });

  test(`${kind} canvas stays inside the viewport at dock and mobile breakpoints`, async ({ page }) => {
    const canvas = await openEditorShell(page, kind, `${kind} dock breakpoints`);
    for (const width of [1920, 1280, 1101, 1100, 761, 760, 390]) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 844 });
        const closed = await bounds(canvas);
        expect(closed.height).toBeGreaterThan(844 * (width <= 760 ? .65 : .8));
        await expect(canvas).toBeInViewport({ ratio: 1 });
        await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
        await expectActiveDock(page, 'Anzeige');
        const open = await bounds(canvas);
        const dock = await bounds(page.locator('.editor-dock'));
        expect(Math.abs(open.height - closed.height)).toBeLessThanOrEqual(1);
        if (width > 1100) {
          // A docked panel consumes only its own width and never covers the canvas.
          expect(Math.abs((closed.width - open.width) - dock.width)).toBeLessThanOrEqual(1);
          expect(open.x + open.width).toBeLessThanOrEqual(dock.x);
        } else {
          // The narrow panel overlays the canvas without resizing it.
          expect(Math.abs(open.width - closed.width)).toBeLessThanOrEqual(1);
          expect(dock.x).toBeLessThan(open.x + open.width);
        }
        await expect(page.locator('.editor-dock')).toBeInViewport({ ratio: 1 });
        await expect(page.getByRole('button', { name: 'Seitenleiste schließen' })).toBeInViewport({ ratio: 1 });
        await expectNoPageOverflow(page);
        await page.getByRole('button', { name: 'Seitenleiste schließen' }).click();
        await expect.poll(async () => (await bounds(canvas)).width).toBeCloseTo(closed.width, 0);
        await expectNoPageOverflow(page);
      });
    }
  });
}

test('Escape closes a property draft without clearing selection, applying or discarding it', async ({ page }) => {
  await openEditorShell(page, 'stage', 'Escape draft');
  await page.getByRole('button', { name: 'Wand hinzufügen', exact: true }).click();
  await commitWallPlacement(page);
  await page.getByRole('button', { name: 'Eigenschaften', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  const originalX = await page.locator('#wall-x').inputValue();
  const mutations: string[] = [];
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith('/layout')) mutations.push(request.url()); });
  await page.locator('#wall-x').fill('2750');
  await page.keyboard.press('Escape');
  await expectActiveDock(page, null);
  await expect(page.getByTestId('selection-count')).toHaveText('1 ausgewählt');
  await expect(page.locator('.save-status')).toHaveText('Nicht übernommene Eingaben');
  await page.keyboard.press('Enter');
  await expectActiveDock(page, 'Eigenschaften');
  await expect(page.locator('#wall-x')).toHaveValue('2750');
  // Discard through the form proves that switching/closing panes never committed the draft.
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.locator('#wall-x')).toHaveValue(originalX);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert');
  expect(mutations).toEqual([]);
});

test('stage and venue panel and pin preferences remain independent across navigation and reload', async ({ page }) => {
  await openEditorShell(page, 'stage', 'Separate dock preferences');
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
  await page.getByRole('button', { name: 'Seitenleiste anheften' }).click();
  await enterVenue(page);
  await expectActiveDock(page, null);
  await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Seitenleiste anheften' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Spielstätte schließen', exact: true }).click();
  await expectActiveDock(page, 'Anzeige');
  await expect(page.getByRole('button', { name: 'Seitenleiste anheften' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expectActiveDock(page, 'Anzeige');
  await enterVenue(page);
  await expectActiveDock(page, 'Bibliothek');
  await expect(page.getByRole('button', { name: 'Seitenleiste anheften' })).toHaveAttribute('aria-pressed', 'false');
});

for (const storage of ['unavailable', 'invalid'] as const) {
  test(`${storage} preferences still allow both editors to open and operate their docks`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      if (mode === 'unavailable') {
        Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } });
      } else {
        for (const scope of ['scene', 'venue']) {
          localStorage.setItem(`stage-planner.editor.${scope}.panel`, 'unknown-panel');
          localStorage.setItem(`stage-planner.editor.${scope}.pinned`, 'invalid');
        }
        localStorage.setItem('stage-planner.editor.view', 'unknown-view');
        localStorage.setItem('stage-planner.editor.venue.view', 'unknown-view');
      }
    }, storage);
    await openEditorShell(page, 'stage', `${storage} storage`);
    for (const kind of ['stage', 'venue']) {
      if (kind === 'venue') await enterVenue(page);
      await expectActiveDock(page, null);
      await expect(page.getByRole('button', { name: 'Grundriss', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
      await expectActiveDock(page, 'Anzeige');
      await page.getByRole('button', { name: 'Seitenleiste anheften' }).click();
      await expect(page.getByRole('button', { name: 'Seitenleiste anheften' })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Seitenleiste schließen' }).click();
    }
    expect(errors).toEqual([]);
  });
}
