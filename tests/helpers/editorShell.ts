import { expect, type Locator, type Page } from '@playwright/test';
import { createProduction, signInToPlans } from './plans.js';

export type EditorKind = 'stage' | 'venue';
export const dockPanels = ['Eigenschaften', 'Bibliothek', 'Licht', 'Anzeige'] as const;
export type DockPanel = typeof dockPanels[number];

export function editorMenu(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Editor-Menüs' }).locator('summary').filter({ hasText: new RegExp(`^${name}$`) });
}

export async function enterVenue(page: Page) {
  await editorMenu(page, 'Datei').click();
  await page.getByRole('button', { name: 'Spielstätte bearbeiten', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Umriss der Spielstätte', exact: true })).toBeVisible();
}

export async function openEditorShell(page: Page, kind: EditorKind, name: string) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signInToPlans(page);
  await createProduction(page, { productionName: name, venueName: `${name} Saal`, sceneName: `${name} Bild` });
  if (kind === 'venue') await enterVenue(page);
  return page.getByRole('img', { name: kind === 'stage' ? 'Grundriss der Spielstätte' : 'Umriss der Spielstätte', exact: true });
}

/** Assert both the accessible controls and the visible pane, including inactive panes. */
export async function expectActiveDock(page: Page, active: DockPanel | null) {
  const rail = page.getByRole('navigation', { name: 'Seitenleisten' });
  for (const name of dockPanels) {
    const button = rail.getByRole('button', { name, exact: true });
    await expect(button).toHaveAttribute('aria-expanded', String(name === active));
    const pane = page.getByRole('region', { name, exact: true, includeHidden: true });
    await expect(pane).toHaveAttribute('id', (await button.getAttribute('aria-controls'))!);
    if (name === active) await expect(pane).toBeVisible();
    else await expect(pane).toBeHidden();
  }
  await expect(page.locator('.dock-pane:visible')).toHaveCount(active ? 1 : 0);
  await expect(page.getByRole('button', { name: 'Seitenleiste schließen' })).toHaveCount(active ? 1 : 0);
}

export async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

export async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > innerWidth,
    vertical: document.documentElement.scrollHeight > innerHeight,
  }))).toEqual({ horizontal: false, vertical: false });
}
