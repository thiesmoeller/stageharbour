import type { Page } from '@playwright/test';

/** Reveal commands that live in the scene editor's application menus. */
export async function revealEditorCommand(page: Page, command: string) {
  if (await page.locator('.venue-editor').isVisible() && ['Kopieren', 'Ausschneiden', 'Einfügen', 'Gruppieren', 'Gruppe auflösen'].includes(command)) return;
  const menu = ['Kopieren', 'Ausschneiden', 'Einfügen', 'Gruppieren', 'Gruppe auflösen'].includes(command) ? 'Bearbeiten' : 'Datei';
  const disclosure = page.locator('.editor-menubar > details').filter({ has: page.locator('summary', { hasText: new RegExp(`^${menu}$`) }) });
  if (await disclosure.count() && await disclosure.getAttribute('open') === null) await disclosure.locator('summary').click();
}
