import type { Page } from '@playwright/test';

/** Always-visible header controls: undo/redo and the view bar need no menu. */
const DIRECT = ['Rückgängig', 'Wiederholen', 'Grundriss', 'Raumsicht', 'Geteilt'];

/** Reveal commands that live in the scene editor's application menus. */
export async function revealEditorCommand(page: Page, command: string) {
  if (DIRECT.includes(command)) return;
  const menu = ['Kopieren', 'Ausschneiden', 'Einfügen', 'Löschen', 'Gruppieren', 'Gruppe auflösen'].includes(command)
    ? 'Bearbeiten'
    : ['Spielstätte', 'Spielstätte bearbeiten', 'Licht einstellen', 'Anzeige einstellen', 'Vollbild umschalten'].includes(command)
      ? 'Ansicht'
      : command === 'Bedienung anzeigen' ? 'Hilfe' : 'Datei';
  const summary = page.locator('.editor-menubar summary').filter({ hasText: new RegExp(`^${menu}$`) });
  await summary.waitFor({ state: 'visible' });
  if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
}
