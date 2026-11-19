import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartGeometry } from '../src/shared/parts/geometry.js';
import { resolvePart } from '../src/shared/parts/resolve.js';
import {
  STARTER_BRACE, STARTER_BRACE_BALLAST, STARTER_CHAIR, STARTER_CONTEXT, STARTER_MATERIALS,
  STARTER_PARTS, STARTER_PERSON,
} from '../src/shared/parts/starter/index.js';

const FALLBACK_COLOR = '#c9cfd2';

const materialColor = (key: string) => {
  const found = STARTER_MATERIALS.find(material => material.key === key);
  assert.ok(found, `starter material ${key}`);
  return found.color;
};

const plates = (resolved: ReturnType<typeof resolvePart>) => resolved.solids.filter(solid => solid.body === 'betonplatte');
const straps = (resolved: ReturnType<typeof resolvePart>) => resolved.solids.filter(solid => solid.body.startsWith('gurt'));

function assertBraceBallast(part: typeof STARTER_BRACE, ballast: 0 | 1 | 2) {
  const resolved = resolvePart(part, { values: { ballast } }, STARTER_CONTEXT);
  assert.deepEqual(resolved.issues.filter(issue => issue.severity === 'error'), [], `${part.name} ballast ${ballast}`);
  assert.equal(plates(resolved).length, ballast, `${part.name}: plate solids`);
  if (ballast < 2) {
    assert.equal(straps(resolved).length, 0, `${part.name}: no strap below two plates`);
  } else {
    assert.ok(straps(resolved).length >= 1, `${part.name}: strap when ballast >= 2`);
    assert.ok(straps(resolved).every(solid => solid.displayOnly === true));
  }
  const beton = resolved.hardware.find(row => row.material === 'betonplatte-400');
  if (ballast === 0) assert.equal(beton, undefined, `${part.name}: no plate hardware`);
  else {
    assert.equal(beton?.quantity, ballast, `${part.name}: hardware plate count once`);
  }
  assert.equal(
    resolved.cutList.sheets.filter(row => row.material === 'betonplatte-400').length,
    0,
    `${part.name}: plates are hardware, not sheet cutlist`,
  );
  const strapHardware = resolved.hardware.find(row => row.material === 'spanngurt-25');
  if (ballast >= 2) assert.equal(strapHardware?.quantity, 1, `${part.name}: strap counted once`);
  else assert.equal(strapHardware, undefined, `${part.name}: no strap hardware`);
}

test('STARTER_BRACE and STARTER_BRACE_BALLAST: plate solids, strap from 2, single-count cutlist', () => {
  for (const part of [STARTER_BRACE, STARTER_BRACE_BALLAST]) {
    assertBraceBallast(part, 0);
    assertBraceBallast(part, 1);
    assertBraceBallast(part, 2);
  }
  // Timber + 2 plates + strap boxes (top + two sides).
  const two = resolvePart(STARTER_BRACE, { values: { ballast: 2 } }, STARTER_CONTEXT);
  assert.equal(two.solids.length, 3 + 2 + 3);
  assert.equal(plates(two).length, 2);
  assert.equal(straps(two).length, 3);
});

test('buildPartGeometry slots for ballast=2 brace carry starter materials with real colours', () => {
  const resolved = resolvePart(STARTER_BRACE, { values: { ballast: 2 } }, STARTER_CONTEXT);
  const { slots } = buildPartGeometry(resolved);
  const materials = new Set(slots.map(slot => slot.material));
  assert.ok(materials.has('latte-40x40'));
  assert.ok(materials.has('betonplatte-400'));
  assert.ok(materials.has('spanngurt-25'));
  for (const key of ['latte-40x40', 'betonplatte-400', 'spanngurt-25'] as const) {
    const color = materialColor(key);
    assert.notEqual(color.toLowerCase(), FALLBACK_COLOR, `${key} is not the StageParts fallback`);
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(color), `${key} colour ${color}`);
  }
});

test('STARTER_PERSON: multi-box mannequin height 1790', () => {
  const resolved = resolvePart(STARTER_PERSON, {}, STARTER_CONTEXT);
  assert.deepEqual(resolved.issues.filter(issue => issue.severity === 'error'), []);
  assert.equal(resolved.height, 1790);
  assert.equal(resolved.bounds.max.y - resolved.bounds.min.y, 1790);
  assert.ok(resolved.solids.length > 1, `expected multi-box person, got ${resolved.solids.length}`);
  assert.equal(STARTER_PERSON.traits?.planSymbol, 'solids');
});

test('STARTER_CHAIR seated figure adds solid keys and bounds', () => {
  const empty = resolvePart(STARTER_CHAIR, {}, STARTER_CONTEXT);
  const seated = resolvePart(STARTER_CHAIR, { state: { seated: 1 } }, STARTER_CONTEXT);
  assert.deepEqual(seated.issues.filter(issue => issue.severity === 'error'), []);
  const figureKeys = seated.solids.map(solid => solid.body).filter(body => body.startsWith('figur-'));
  assert.deepEqual([...new Set(figureKeys)].sort(), ['figur-beine', 'figur-kopf', 'figur-rumpf']);
  assert.ok(seated.solids.length > empty.solids.length);
  assert.ok(seated.bounds.max.y > empty.bounds.max.y || seated.bounds.max.z !== empty.bounds.max.z
    || seated.solids.some(solid => solid.body.startsWith('figur-')), 'seated figure has distinct solids/bounds');
  for (const key of ['figur-rumpf', 'figur-beine', 'figur-kopf']) {
    const solid = seated.solids.find(item => item.body === key);
    assert.ok(solid, key);
    assert.ok(Number.isFinite(solid.kind === 'box' ? solid.center.y : NaN));
  }
});

test('every STARTER_PARTS entry resolves with non-empty solids and finite bounds', () => {
  for (const part of STARTER_PARTS) {
    const configs: { label: string; variant?: string }[] = [{ label: 'default' }];
    for (const variant of part.variants ?? []) configs.push({ label: variant.key, variant: variant.key });
    for (const config of configs) {
      const resolved = resolvePart(part, config.variant ? { variant: config.variant } : {}, STARTER_CONTEXT);
      const tag = `${part.name} / ${config.label}`;
      assert.ok(resolved.solids.length > 0, `${tag}: solids`);
      const { min, max } = resolved.bounds;
      for (const axis of ['x', 'y', 'z'] as const) {
        assert.ok(Number.isFinite(min[axis]) && Number.isFinite(max[axis]), `${tag}: bounds ${axis}`);
      }
      assert.ok(max.x >= min.x && max.y >= min.y && max.z >= min.z, `${tag}: ordered bounds`);
    }
  }
});
