import assert from 'node:assert/strict';
import { boxCorners } from './pose.js';
import { loadGolden } from './store.js';
import type {
  NeutralBox, NeutralElementSolids, NeutralFootprints, NeutralLists, NeutralSolids, NeutralSurfaces, NeutralWarning, Point,
  Vec3,
} from './types.js';

/** Default numeric tolerance in millimetres. */
export const DEFAULT_TOLERANCE_MM = 0.5;

export type CompareOptions = {
  /** Largest allowed numeric difference in millimetres (default 0.5). */
  tolerance?: number;
};

export type Mismatch = { path: string; message: string };

const tolerance = (options?: CompareOptions) => options?.tolerance ?? DEFAULT_TOLERANCE_MM;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const distance3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Largest vertex distance between two rings, over every start vertex and both windings. Infinity if lengths differ. */
export function polygonDeviation(a: readonly Point[], b: readonly Point[]): number {
  if (a.length !== b.length) return Infinity;
  if (!a.length) return 0;
  let best = Infinity;
  for (const direction of [1, -1]) {
    for (let offset = 0; offset < a.length; offset++) {
      let worst = 0;
      for (let index = 0; index < a.length; index++) {
        const other = b[((direction * index + offset) % b.length + b.length) % b.length]!;
        worst = Math.max(worst, distance(a[index]!, other));
        if (worst >= best) break;
      }
      best = Math.min(best, worst);
    }
  }
  return best;
}

/** Polygons match when they have the same vertices in the same cyclic order; start vertex and winding are ignored. */
export function polygonsMatch(a: readonly Point[], b: readonly Point[], options?: CompareOptions): boolean {
  return polygonDeviation(a, b) <= tolerance(options);
}

function boxDeviation(a: Pick<NeutralBox, 'center' | 'size' | 'rotation'>, b: Pick<NeutralBox, 'center' | 'size' | 'rotation'>) {
  const left = boxCorners(a), right = boxCorners(b);
  const side = (from: Vec3[], to: Vec3[]) => Math.max(...from.map(corner => Math.min(...to.map(other => distance3(corner, other)))));
  return Math.max(side(left, right), side(right, left));
}

/** Boxes match when their eight corner points coincide, so rotation order, axis swaps and ±180° flips are irrelevant. */
export function boxesMatch(a: NeutralBox, b: NeutralBox, options?: CompareOptions): boolean {
  return boxDeviation(a, b) <= tolerance(options);
}

function describeBox(box: NeutralBox) {
  const f = (value: number) => Math.round(value * 10) / 10;
  return `${box.part} centre (${f(box.center.x)}, ${f(box.center.y)}, ${f(box.center.z)}) size (${f(box.size.x)}, ${f(box.size.y)}, ${f(box.size.z)})`;
}

function matchUnordered<T>(
  path: string, expected: readonly T[], actual: readonly T[], matches: (a: T, b: T) => boolean, describe: (item: T) => string,
): Mismatch[] {
  const unused = [...actual];
  const missing: T[] = [];
  for (const item of expected) {
    const index = unused.findIndex(candidate => matches(item, candidate));
    if (index < 0) missing.push(item);
    else unused.splice(index, 1);
  }
  const found: Mismatch[] = [];
  for (const item of missing) found.push({ path, message: `missing in actual: ${describe(item)}` });
  for (const item of unused) found.push({ path, message: `unexpected in actual: ${describe(item)}` });
  return found;
}

/** Compare two sets of boxes ignoring order (and part names). */
export function compareBoxes(expected: readonly NeutralBox[], actual: readonly NeutralBox[], options?: CompareOptions): Mismatch[] {
  return matchUnordered('boxes', expected, actual, (a, b) => boxesMatch(a, b, options), describeBox);
}

function compareElementSolids(id: string, expected: NeutralElementSolids, actual: NeutralElementSolids, options?: CompareOptions): Mismatch[] {
  const tol = tolerance(options);
  const found = compareBoxes(expected.boxes, actual.boxes, options).map(item => ({ ...item, path: `${id}.${item.path}` }));
  found.push(...matchUnordered(`${id}.spheres`, expected.spheres ?? [], actual.spheres ?? [],
    (a, b) => distance3(a.center, b.center) <= tol && near(a.radius, b.radius, tol),
    sphere => `${sphere.part} radius ${sphere.radius}`));
  found.push(...matchUnordered(`${id}.prisms`, expected.prisms ?? [], actual.prisms ?? [],
    (a, b) => polygonsMatch(a.outline, b.outline, options) && near(a.bottom, b.bottom, tol) && near(a.top, b.top, tol),
    prism => `${prism.part} ${prism.bottom}..${prism.top}`));
  return found;
}

function compareById<T>(
  expected: Record<string, T>, actual: Record<string, T>, each: (id: string, expected: T, actual: T) => Mismatch[],
  options?: { allowExtra?: boolean; ids?: readonly string[] },
): Mismatch[] {
  const found: Mismatch[] = [];
  const ids = options?.ids ?? Object.keys(expected);
  for (const id of ids) {
    const left = expected[id], right = actual[id];
    if (left === undefined) continue;
    if (right === undefined) found.push({ path: id, message: 'missing in actual' });
    else found.push(...each(id, left, right));
  }
  if (!options?.allowExtra && !options?.ids) {
    for (const id of Object.keys(actual)) if (expected[id] === undefined) found.push({ path: id, message: 'unexpected in actual' });
  }
  return found;
}

export type ElementSetOptions = CompareOptions & {
  /** Only compare these element ids. */
  ids?: readonly string[];
  /** Do not report elements that exist only in `actual`. */
  allowExtra?: boolean;
  /** Also require the v1 kind to match (off by default: kinds are metadata once parts are parametric). */
  compareKind?: boolean;
};

export function compareFootprints(expected: NeutralFootprints, actual: NeutralFootprints, options?: ElementSetOptions): Mismatch[] {
  return compareById(expected, actual, (id, left, right) => {
    const found: Mismatch[] = [];
    if (options?.compareKind && left.kind !== right.kind) found.push({ path: id, message: `kind ${left.kind} != ${right.kind}` });
    const deviation = polygonDeviation(left.polygon, right.polygon);
    if (deviation > tolerance(options)) {
      found.push({
        path: id,
        message: left.polygon.length === right.polygon.length
          ? `polygon deviates by up to ${deviation.toFixed(3)} mm`
          : `polygon has ${right.polygon.length} vertices, expected ${left.polygon.length}`,
      });
    }
    return found;
  }, options);
}

export function compareSolids(expected: NeutralSolids, actual: NeutralSolids, options?: ElementSetOptions): Mismatch[] {
  return compareById(expected, actual, (id, left, right) => compareElementSolids(id, left, right, options), options);
}

export function compareSurfaces(expected: NeutralSurfaces, actual: NeutralSurfaces, options?: ElementSetOptions): Mismatch[] {
  const tol = tolerance(options);
  const byId = (surfaces: NeutralSurfaces['surfaces']) => Object.fromEntries(surfaces.map(surface => [surface.id, surface]));
  const found = compareById(byId(expected.surfaces), byId(actual.surfaces), (id, left, right) => {
    const problems: Mismatch[] = [];
    if (!near(left.elevation, right.elevation, tol)) {
      problems.push({ path: `surface ${id}`, message: `elevation ${right.elevation} != ${left.elevation}` });
    }
    if (!polygonsMatch(left.outline, right.outline, options)) problems.push({ path: `surface ${id}`, message: 'outline differs' });
    return problems;
  }, { allowExtra: options?.allowExtra });
  found.push(...compareById(expected.elevations, actual.elevations, (id, left, right) =>
    near(left, right, tol) ? [] : [{ path: `elevation ${id}`, message: `${right} != ${left}` }], options));
  return found;
}

const warningKey = (item: NeutralWarning, withMessage: boolean) =>
  `${item.family}|${item.kind}|${[...item.ids].sort().join(',')}${withMessage ? `|${item.message}` : ''}`;

export type WarningOptions = { compareMessages?: boolean };

/** Warnings are compared as a multiset of family, kind and involved ids; messages only on request. */
export function compareWarnings(expected: readonly NeutralWarning[], actual: readonly NeutralWarning[], options?: WarningOptions): Mismatch[] {
  const withMessage = options?.compareMessages ?? false;
  return matchUnordered('warnings', expected, actual,
    (a, b) => warningKey(a, withMessage) === warningKey(b, withMessage), item => warningKey(item, true));
}

function walkValues(path: string, expected: unknown, actual: unknown, tol: number, found: Mismatch[]) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (!near(expected, actual, tol)) found.push({ path, message: `${actual} != ${expected}` });
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) found.push({ path: `${path}.length`, message: `${actual.length} != ${expected.length}` });
    for (let index = 0; index < Math.min(expected.length, actual.length); index++) walkValues(`${path}[${index}]`, expected[index], actual[index], tol, found);
  } else if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      const left = (expected as Record<string, unknown>)[key], right = (actual as Record<string, unknown>)[key];
      if (left === undefined) found.push({ path: `${path}.${key}`, message: 'unexpected in actual' });
      else if (right === undefined) found.push({ path: `${path}.${key}`, message: 'missing in actual' });
      else walkValues(`${path}.${key}`, left, right, tol, found);
    }
  } else if (expected !== actual) {
    found.push({ path, message: `${JSON.stringify(actual)} != ${JSON.stringify(expected)}` });
  }
}

/** Structural comparison of list structures (counts, labels, rows); numbers use the tolerance, order of arrays matters. */
export function compareLists(expected: NeutralLists, actual: NeutralLists, options?: CompareOptions & { keys?: readonly string[] }): Mismatch[] {
  const found: Mismatch[] = [];
  const keys = options?.keys ?? Object.keys(expected);
  for (const key of keys) {
    if (!(key in expected)) continue;
    if (!(key in actual)) found.push({ path: key, message: 'missing in actual' });
    else walkValues(key, expected[key], actual[key], tolerance(options), found);
  }
  return found;
}

export function describeMismatches(mismatches: readonly Mismatch[], limit = 12) {
  const shown = mismatches.slice(0, limit).map(item => `  ${item.path}: ${item.message}`).join('\n');
  return mismatches.length > limit ? `${shown}\n  ... and ${mismatches.length - limit} more` : shown;
}

export function assertNoMismatches(label: string, mismatches: readonly Mismatch[]) {
  assert.equal(mismatches.length, 0, `${label}: ${mismatches.length} mismatch(es)\n${describeMismatches(mismatches)}`);
}

type StoredFootprints = { elements: Record<string, { kind: string; polygon: Point[] }> };
type StoredSolids = { elements: Record<string, NeutralElementSolids> };
type StoredSurfaces = { surfaces: { id: string; elevation: number; outline: Point[] }[]; resolved: Record<string, { elevation: number }> };
type StoredWarnings = { warnings: NeutralWarning[] };

export function goldenFootprints(fixture: string): NeutralFootprints {
  const stored = loadGolden<StoredFootprints>(fixture, 'footprints');
  return Object.fromEntries(Object.entries(stored.elements).map(([id, item]) => [id, { kind: item.kind, polygon: item.polygon }]));
}

export function goldenSolids(fixture: string): NeutralSolids {
  const stored = loadGolden<StoredSolids>(fixture, 'solids');
  return Object.fromEntries(Object.entries(stored.elements).map(([id, item]) => [id, {
    boxes: item.boxes, ...item.spheres ? { spheres: item.spheres } : {}, ...item.prisms ? { prisms: item.prisms } : {},
  }]));
}

export function goldenSurfaces(fixture: string): NeutralSurfaces {
  const stored = loadGolden<StoredSurfaces>(fixture, 'surfaces');
  return {
    surfaces: stored.surfaces.map(surface => ({ id: surface.id, outline: surface.outline, elevation: surface.elevation })),
    elevations: Object.fromEntries(Object.entries(stored.resolved).map(([id, item]) => [id, item.elevation])),
  };
}

export function goldenWarnings(fixture: string): NeutralWarning[] {
  return loadGolden<StoredWarnings>(fixture, 'warnings').warnings;
}

export function goldenLists(fixture: string): NeutralLists {
  return loadGolden<NeutralLists>(fixture, 'lists');
}

export type NeutralPipelineOutput = {
  footprints?: NeutralFootprints;
  solids?: NeutralSolids;
  surfaces?: NeutralSurfaces;
  warnings?: NeutralWarning[];
  lists?: NeutralLists;
};

/**
 * Compare whatever aspects a different pipeline produced against the named golden fixture.
 * Aspects the pipeline leaves out are skipped.
 */
export function compareToGolden(
  fixture: string, output: NeutralPipelineOutput, options?: ElementSetOptions & WarningOptions & { listKeys?: readonly string[] },
): Mismatch[] {
  const found: Mismatch[] = [];
  const tag = (aspect: string, items: Mismatch[]) => found.push(...items.map(item => ({ ...item, path: `${aspect}: ${item.path}` })));
  if (output.footprints) tag('footprints', compareFootprints(goldenFootprints(fixture), output.footprints, options));
  if (output.solids) tag('solids', compareSolids(goldenSolids(fixture), output.solids, options));
  if (output.surfaces) tag('surfaces', compareSurfaces(goldenSurfaces(fixture), output.surfaces, options));
  if (output.warnings) tag('warnings', compareWarnings(goldenWarnings(fixture), output.warnings, options));
  if (output.lists) tag('lists', compareLists(goldenLists(fixture), output.lists, { ...options, keys: options?.listKeys }));
  return found;
}

export function assertMatchesGolden(fixture: string, output: NeutralPipelineOutput, options?: Parameters<typeof compareToGolden>[2]) {
  assertNoMismatches(`golden ${fixture}`, compareToGolden(fixture, output, options));
}
