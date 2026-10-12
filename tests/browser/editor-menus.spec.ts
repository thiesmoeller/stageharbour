import { test, expect } from '@playwright/test';
import { editorMenu, expectActiveDock, openEditorShell } from '../helpers/editorShell.js';

for (const kind of ['stage', 'venue'] as const) {
  test(`${kind} menus support keyboard dismissal, outside dismissal and command focus`, async ({ page }) => {
    await openEditorShell(page, kind, `${kind} keyboard menus`);
    const file = editorMenu(page, 'Datei');
    const edit = editorMenu(page, 'Bearbeiten');
    const view = editorMenu(page, 'Ansicht');
    const fileCommand = page.getByRole('button', { name: kind === 'stage' ? 'PDF gestalten' : 'Entwurf herunterladen', exact: true });
    const backCommand = page.getByRole('navigation', { name: 'Editor-Menüs' }).getByRole('button', {
      name: kind === 'stage' ? 'Zur Übersicht' : 'Spielstätte schließen', exact: true,
    });

    await file.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(fileCommand).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(fileCommand).toBeHidden();
    await expect(file).toBeFocused();

    await page.keyboard.press('Space');
    await expect(fileCommand).toBeVisible();
    await backCommand.focus();
    await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    await expect(fileCommand).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Kopieren', exact: true })).toBeDisabled();
    await file.click();
    await expect(page.getByRole('button', { name: 'Kopieren', exact: true })).toBeHidden();
    await expect(fileCommand).toBeVisible();
    await page.getByRole('heading', { name: `${kind} keyboard menus ${kind === 'stage' ? 'Bild' : 'Saal'}`, exact: true }).click();
    await expect(fileCommand).toBeHidden();

    await view.click();
    await page.getByRole('button', { name: 'Anzeige einstellen', exact: true }).click();
    await expectActiveDock(page, 'Anzeige');
    await expect(view).toBeFocused();
    await expect(page.getByRole('button', { name: 'Anzeige einstellen', exact: true })).toBeHidden();
    await file.click();
    await page.keyboard.press('Escape');
    await expect(file).toBeFocused();
    await expectActiveDock(page, 'Anzeige');
  });

  test(`${kind} fullscreen repeatedly moves one functioning menu bar without resetting the dock`, async ({ page }) => {
    await openEditorShell(page, kind, `${kind} fullscreen menus`);
    await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Namen', exact: true }).uncheck();
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.getByRole('button', { name: 'Vollbild', exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await expect(page.getByRole('navigation', { name: 'Editor-Menüs' })).toHaveCount(1);
      await expect(page.locator('#editor-menu-slot nav')).toHaveCount(0);
      await expect(page.locator('.editor-local-menubar nav')).toBeVisible();
      await expectActiveDock(page, 'Anzeige');
      await expect(page.getByRole('checkbox', { name: 'Namen', exact: true })).not.toBeChecked();
      await editorMenu(page, 'Ansicht').click();
      await page.getByRole('button', { name: 'Licht einstellen', exact: true }).click();
      await expectActiveDock(page, 'Licht');
      // Leave fullscreen through the relocated application menu, not a DOM shortcut.
      await editorMenu(page, 'Ansicht').click();
      await page.getByRole('button', { name: 'Vollbild umschalten', exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
      await expect(page.getByRole('navigation', { name: 'Editor-Menüs' })).toHaveCount(1);
      await expect(page.locator('.editor-local-menubar')).toHaveCount(0);
      await expect(page.locator('#editor-menu-slot nav')).toBeVisible();
      await editorMenu(page, 'Ansicht').click();
      await page.getByRole('button', { name: 'Anzeige einstellen', exact: true }).click();
      await expectActiveDock(page, 'Anzeige');
      await expect(page.getByRole('checkbox', { name: 'Namen', exact: true })).not.toBeChecked();
    }
  });
}
