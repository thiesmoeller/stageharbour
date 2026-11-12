import type { Page } from '@playwright/test';

/** Reveal commands that live in the scene editor's application menus. */
export async function revealEditorCommand(page: Page, command: string) {
  const menu = ['Rückgängig', 'Wiederholen', 'Kopieren', 'Ausschneiden', 'Einfügen', 'Löschen', 'Gruppieren', 'Gruppe auflösen'].includes(command)
    ? 'Bearbeiten'
    : ['Grundriss', 'Raumsicht', 'Geteilt', 'Spielstätte', 'Spielstätte bearbeiten'].includes(command)
      ? 'Ansicht'
      : 'Datei';
  const summary = page.locator('.editor-menubar summary').filter({ hasText: new RegExp(`^${menu}$`) });
  await summary.waitFor({ state: 'visible' });
  if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
}
