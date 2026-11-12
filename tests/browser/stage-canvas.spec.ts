import { test, expect, type Page } from '@playwright/test';
import { LIGHT_THEMES, LIGHT_THEME_IDS } from '../../src/client/stage/lightThemes.js';
import type { Vec3 } from '../../src/client/stage/cameraFraming.js';

type Rgba = [number, number, number, number];
type CanvasId = 'a' | 'b';

declare global {
  interface Window { __webglContexts?: (WebGLRenderingContext | WebGL2RenderingContext)[] }
}

const rgb = (hex: string) => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
const luminance = ([r, g, b]: Rgba) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const distance = (a: Rgba, b: number[]) => Math.max(...[0, 1, 2].map(index => Math.abs(a[index]! - b[index]!)));

async function corner(page: Page, id: CanvasId) {
  const box = await page.getByTestId(`stage-canvas-${id}`).boundingBox();
  if (!box) throw new Error(`canvas ${id} has no box`);
  return { x: box.x + 6, y: box.y + 6 };
}

const sample = (page: Page, id: CanvasId, point: { x: number; y: number }) =>
  page.evaluate(({ id, point }) => window.__stageHarness!.sample(id, point.x, point.y), { id, point }) as Promise<Rgba>;
const project = (page: Page, id: CanvasId, point: Vec3) =>
  page.evaluate(({ id, point }) => window.__stageHarness!.project(id, point), { id, point: [...point] as [number, number, number] });
const liveContexts = (page: Page) => page.evaluate(() => (window.__webglContexts ?? []).filter(context => !context.isContextLost()).length);

async function openHarness(page: Page) {
  await page.addInitScript(() => {
    const contexts: (WebGLRenderingContext | WebGL2RenderingContext)[] = [];
    window.__webglContexts = contexts;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const context = (getContext as (type: string, ...rest: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      if ((context instanceof WebGLRenderingContext || context instanceof WebGL2RenderingContext) && !contexts.includes(context)) contexts.push(context);
      return context;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/?stage-harness#/__stage-canvas');
  await expect(page.getByTestId('stage-harness')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__stageHarness?.ready('a') && window.__stageHarness.ready('b'))).toBe(true);
}

test('StageCanvas renders independent canvases with themes, quality, pointer misses and clean disposal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openHarness(page);

  await test.step('two canvases render at once', async () => {
    await expect(page.locator('[data-testid="stage-harness"] canvas')).toHaveCount(2);
    const box = await sample(page, 'a', await project(page, 'a', [0, 0.5, 0]));
    const part = await sample(page, 'b', await project(page, 'b', [0, 0.6, 0]));
    expect(distance(box, rgb(LIGHT_THEMES.studio.background))).toBeGreaterThan(40);
    expect(distance(part, rgb(LIGHT_THEMES.sunset.background))).toBeGreaterThan(40);
    expect(distance(await sample(page, 'b', await corner(page, 'b')), rgb(LIGHT_THEMES.sunset.background))).toBeLessThanOrEqual(3);
    expect(await liveContexts(page)).toBe(2);
  });

  await test.step('each light theme sets its own background', async () => {
    const backgrounds = [];
    for (const id of LIGHT_THEME_IDS) {
      await page.getByLabel('Lichtstimmung').selectOption(id);
      const pixel = await sample(page, 'a', await corner(page, 'a'));
      expect(distance(pixel, rgb(LIGHT_THEMES[id].background)), `${id} background`).toBeLessThanOrEqual(3);
      backgrounds.push(pixel.slice(0, 3).join(','));
    }
    expect(new Set(backgrounds).size).toBe(LIGHT_THEME_IDS.length);
    await page.getByLabel('Lichtstimmung').selectOption('studio');
  });

  await test.step('pointer misses fire on empty space only, per canvas', async () => {
    const empty = await corner(page, 'a');
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId('missed-a')).toHaveText('1');
    await expect(page.getByTestId('hits-a')).toHaveText('0');
    const box = await project(page, 'a', [0, 0.5, 0]);
    await page.mouse.click(box.x, box.y);
    await expect(page.getByTestId('hits-a')).toHaveText('1');
    await expect(page.getByTestId('missed-a')).toHaveText('1');
    await expect(page.getByTestId('missed-b')).toHaveText('0');
    const emptyB = await corner(page, 'b');
    await page.mouse.click(emptyB.x, emptyB.y);
    await expect(page.getByTestId('missed-b')).toHaveText('1');
    await expect(page.getByTestId('missed-a')).toHaveText('1');
  });

  await test.step('enhanced quality turns shadows on, simple turns them off', async () => {
    const shadowed = await project(page, 'a', [-0.9, 0.001, -0.9]);
    const open = await project(page, 'a', [1.6, 0.001, -1.6]);
    expect(await page.evaluate(() => window.__stageHarness!.shadows('a'))).toBe(false);
    const simple = { shadowed: await sample(page, 'a', shadowed), open: await sample(page, 'a', open) };
    const toggle = page.getByLabel('Erweiterte Darstellung');
    await toggle.check();
    await expect.poll(() => page.evaluate(() => window.__stageHarness!.shadows('a'))).toBe(true);
    const enhanced = { shadowed: await sample(page, 'a', shadowed), open: await sample(page, 'a', open) };
    expect(luminance(enhanced.shadowed)).toBeLessThan(luminance(simple.shadowed) - 20);
    expect(Math.abs(luminance(enhanced.open) - luminance(simple.open))).toBeLessThan(8);
    await toggle.uncheck();
    await expect.poll(() => page.evaluate(() => window.__stageHarness!.shadows('a'))).toBe(false);
    expect(luminance(await sample(page, 'a', shadowed))).toBeGreaterThan(luminance(enhanced.shadowed) + 20);
  });

  await test.step('mounting and unmounting 10 times leaves no extra canvases or contexts', async () => {
    const toggle = page.getByRole('button', { name: /^Vorschau (entfernen|einsetzen)$/ });
    const canvases = page.locator('[data-testid="stage-harness"] canvas');
    for (let cycle = 0; cycle < 10; cycle++) {
      await toggle.click();
      await expect(canvases).toHaveCount(1);
      await toggle.click();
      await expect(canvases).toHaveCount(2);
    }
    await expect(page.getByTestId('preview-mounts')).toHaveText('21');
    await expect.poll(() => page.evaluate(() => window.__stageHarness?.ready('b'))).toBe(true);
    await expect.poll(() => liveContexts(page)).toBe(2);
    const part = await sample(page, 'b', await project(page, 'b', [0, 0.6, 0]));
    expect(distance(part, rgb(LIGHT_THEMES.sunset.background))).toBeGreaterThan(40);
  });

  expect(errors).toEqual([]);
});
