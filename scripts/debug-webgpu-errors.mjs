/**
 * Feedback loop: open Raumsicht and count Pascal WebGPU console errors.
 * Exit 1 if Fallback render / createBuffer errors appear.
 *
 * Usage: node scripts/debug-webgpu-errors.mjs
 * Expects: vite+api on APP_ORIGIN (default http://localhost:5174)
 */
import { chromium } from 'playwright';

const origin = process.env.APP_ORIGIN ?? 'http://localhost:5174';
const email = process.env.LOGIN_EMAIL ?? 'admin@example.test';
const password = process.env.LOGIN_PASSWORD ?? 'local-admin-7319';
const settleMs = Number(process.env.SETTLE_MS ?? 4000);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer'],
});
const page = await browser.newPage();
const hits = [];
page.on('console', msg => {
  const text = msg.text();
  if (/Fallback render failed|createBuffer failed|mappedAtCreation/i.test(text)) hits.push(text);
});
page.on('pageerror', err => {
  const text = String(err);
  if (/Fallback render failed|createBuffer failed|mappedAtCreation/i.test(text)) hits.push(text);
});

await page.goto(origin);
await page.getByLabel('E-Mail-Adresse').fill(email);
await page.getByLabel('Passwort', { exact: true }).fill(password);
await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
await page.getByText('Angemeldet als').waitFor({ timeout: 15_000 });
await page.getByText(/Bühnenbild öffnen/).first().click();
await page.locator('[data-renderer="pascal"] canvas').first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(settleMs);

const sample = hits.slice(0, 3);
console.log(JSON.stringify({ origin, settleMs, hitCount: hits.length, sample }, null, 2));

await browser.close();
process.exit(hits.length > 0 ? 1 : 0);
