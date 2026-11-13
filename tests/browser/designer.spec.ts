import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { testAdministrator, testEditor } from '../helpers/database.js';
import { signInToPlans } from '../helpers/plans.js';

const STARTER_TABLE_ID = '5a17e9a0-0000-4000-8000-000000000005';

async function openDesigner(page: Page) {
  await page.getByRole('navigation', { name: 'Arbeitsbereiche' }).getByRole('button', { name: /Bühnentechnik/ }).click();
  await expect(page).toHaveURL(/#\/designer$/);
  await expect(page.getByTestId('designer-page')).toBeVisible();
}

async function copyStarter(page: Page, name: string) {
  await page.getByTestId('designer-starters').getByRole('button', { name: `${name} als Kopie anlegen` }).click();
  await expect(page).toHaveURL(/#\/designer\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('designer-title')).toHaveText(new RegExp(`^${name} Kopie`));
  return decodeURIComponent(page.url().split('/').pop()!);
}

test('designer copies a starter part, edits a parameter live and saves a new revision', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInToPlans(page);
  await openDesigner(page);
  await expect(page.getByTestId('designer-empty')).toBeVisible();

  const partId = await copyStarter(page, 'Tisch');
  expect(partId).not.toBe(STARTER_TABLE_ID);
  const cutList = page.getByTestId('designer-cutlist');
  await expect(cutList).toContainText('722 mm');
  await expect(page.getByTestId('designer-view-front')).toBeVisible();
  await expect(page.getByTestId('designer-preview')).toHaveAttribute('data-solids', '5');
  const geometryBefore = await page.getByTestId('designer-preview').getAttribute('data-geometry');
  const weightBefore = await page.getByTestId('designer-weight').textContent();
  await expect(page.getByTestId('designer-save')).toBeDisabled();

  await page.getByTestId('parameter-default-H').fill('900');
  await expect(cutList).toContainText('872 mm');
  await expect(page.getByTestId('designer-view-size-front')).toContainText('900');
  await expect(page.getByTestId('designer-preview')).not.toHaveAttribute('data-geometry', geometryBefore!);
  await expect(page.getByTestId('designer-weight')).not.toHaveText(weightBefore!);

  const thickness = page.getByTestId('derived-staerke');
  await thickness.fill('B +');
  await expect(page.locator('.derived-row .formula-value.error')).toContainText('Zeichen');
  await expect(page.getByTestId('designer-issues')).toContainText('verhindert das Speichern');
  await expect(page.getByTestId('designer-save')).toBeDisabled();
  await thickness.fill('28');
  await expect(page.getByTestId('designer-issues')).toContainText('Keine Fehler');

  await page.getByTestId('designer-save').click();
  await expect(page.getByTestId('designer-status')).toContainText('Gespeichert als Revision 2');
  await page.reload();
  await expect(page.getByTestId('designer-title')).toHaveText(/^Tisch Kopie/);
  await expect(page.getByTestId('parameter-default-H')).toHaveValue('900');
  await expect(page.getByTestId('designer-cutlist')).toContainText('872 mm');
  await expect(page.getByTestId('designer-savebar')).toContainText('Revision 2');

  await page.goto('/#/designer/00000000-0000-4000-8000-0000000000ff');
  await expect(page.getByTestId('designer-missing')).toContainText('Bauteil nicht gefunden');
  await page.getByRole('link', { name: 'Zur Bauteilbibliothek' }).click();
  await expect(page).toHaveURL(/#\/designer$/);
  await expect(page.getByTestId('designer-empty')).toBeVisible();
  expect(errors).toEqual([]);
});

test('designer exports a part and imports the edited file as a new revision', async ({ page }) => {
  await signInToPlans(page);
  await openDesigner(page);
  const partId = await copyStarter(page, 'Stützdreieck');

  const downloading = page.waitForEvent('download');
  await page.getByTestId('designer-library').getByRole('button', { name: 'Exportieren', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.stageharbour-parts\.json$/);
  const library = JSON.parse(await readFile((await download.path())!, 'utf8')) as {
    parts: { id: string; revision: number; name: string }[];
  };
  const exported = library.parts.filter(part => part.id === partId).sort((a, b) => b.revision - a.revision)[0]!;
  expect(exported).toBeTruthy();
  exported.name = 'Stützdreieck Import';

  await page.getByTestId('designer-import-file').setInputFiles({
    name: 'bearbeitet.stageharbour-parts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(library)),
  });
  const report = page.getByTestId('designer-import-report');
  await expect(report).toContainText('1 überarbeitet');
  await expect(report).toContainText('Stützdreieck Import (Rev. 2)');
  await expect(page.getByTestId('designer-title')).toHaveText('Stützdreieck Import');
  await expect(page.getByTestId('designer-savebar')).toContainText('Revision 2');
  await expect(page.getByTestId('designer-part-list')).toContainText('Stützdreieck Import');
});

test('viewers can open parts in the designer but not change or save them', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInToPlans(admin, testAdministrator);
  const setEditorRole = (role: 'viewer' | 'editor') => admin.evaluate(async ({ role, email }) => {
    const me = await (await fetch('/api/me')).json() as { workspace: { id: string } };
    const members = await (await fetch(`/api/workspaces/${me.workspace.id}/members`)).json() as { userId: string; email: string }[];
    const member = members.find(item => item.email === email)!;
    const response = await fetch(`/api/workspaces/${me.workspace.id}/members/${member.userId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    });
    if (!response.ok) throw new Error(`Rolle nicht geändert: ${response.status}`);
  }, { role, email: testEditor.email });
  await setEditorRole('viewer');
  try {
    const viewer = await viewerContext.newPage();
    await signInToPlans(viewer, testEditor);
    await openDesigner(viewer);
    await expect(viewer.getByTestId('designer-readonly')).toBeVisible();
    await expect(viewer.getByTestId('designer-library').getByRole('button', { name: 'Neu', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /als Kopie anlegen/ })).toHaveCount(0);
    await viewer.getByTestId('designer-starters').getByRole('listitem').filter({ hasText: 'Tisch' }).getByRole('button', { name: 'Öffnen' }).click();
    await expect(viewer).toHaveURL(new RegExp(`#/designer/${STARTER_TABLE_ID}$`));
    await expect(viewer.getByTestId('designer-title')).toHaveText('Tisch');
    await expect(viewer.getByTestId('designer-cutlist')).toContainText('722 mm');
    await expect(viewer.getByTestId('part-name')).toBeDisabled();
    await expect(viewer.getByTestId('parameter-default-H')).toBeDisabled();
    await expect(viewer.getByTestId('designer-save')).toHaveCount(0);
  } finally {
    await setEditorRole('editor');
    await adminContext.close();
    await viewerContext.close();
  }
});
