import { expect, type Page } from '@playwright/test';
import { testAdministrator } from './database.js';

/** Sign in as the test administrator and land on the plans overview. */
export async function signInToPlans(page: Page, account: { email: string; password: string } = testAdministrator) {
  await page.goto('/');
  await page.getByLabel('E-Mail-Adresse').fill(account.email);
  await page.getByLabel('Passwort', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beispiel-Theatergruppe' })).toBeVisible();
}

export type CreateProductionOptions = {
  productionName: string;
  sceneName?: string;
  /** Create a brand-new venue (forces "Neue Spielstätte anlegen" when venues already exist). */
  venueName?: string;
  width?: string;
  depth?: string;
  /** Reuse an existing venue by option label. */
  existingVenue?: string;
};

/** Open the Neue Produktion form and submit. Prefer this over duplicating CTA labels in specs. */
export async function createProduction(page: Page, options: CreateProductionOptions) {
  await page.getByRole('button', { name: 'Neue Produktion' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill(options.productionName);
  const venueSelect = page.getByLabel('Vorhandene Spielstätte');
  if (options.existingVenue) {
    await venueSelect.selectOption({ label: options.existingVenue });
  } else if (options.venueName !== undefined) {
    if (await venueSelect.count()) await venueSelect.selectOption({ value: '' });
    await page.getByRole('textbox', { name: 'Spielstätte' }).fill(options.venueName);
    await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill(options.width ?? '8000');
    await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill(options.depth ?? '6000');
  }
  if (options.sceneName !== undefined) {
    await page.getByRole('textbox', { name: 'Bühnenbild' }).fill(options.sceneName);
  }
  await page.getByRole('button', { name: 'Produktion anlegen' }).click();
}
