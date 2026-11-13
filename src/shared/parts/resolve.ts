import {
  BODY_MATERIAL_KIND, MATERIAL_KIND_LABELS, MAX_PART_COORDINATE_MM, MIN_BODY_DIMENSION_MM, PART_LIMITS,
  matchVariant, normalizeParameterValue, partRefKey, variantValues,
  type BeamBody, type BoxBody, type FormulaVec2, type FormulaVec3, type PartBody, type PartChild, type PartContext,
  type PartDefinition, type PartFaceSide, type PartMaterial, type PartRef, type PartRepeat, type PartTraits,
  type SheetBody, type SheetHole, type StockMode,
} from './definition.js';
import { FormulaError, evaluateFormula, formulaIdentifiers, parseFormula, type Formula } from './formula.js';
import { formatNumber, formulaIssue, issue, type PartIssue, type PartIssueSubject } from './issues.js';
import {
  FLUSH_EPS_MM, QUAT_IDENTITY, VEC3_ZERO, add, applyTransform, boundsOf, cleanPolygon, convexHull, cross, distanceToBoundary,
  isSimplePolygon, length, loopsOverlap, normalize, pointInPolygon, polygonArea, polygonBounds, polygonPerimeter,
  quatAxes, quatFromAxisAngle, quatFromBasis, quatFromEulerDegrees, quatMultiply, rotate, scale, segmentsTouch, sub,
  subtractPolygon, withWinding,
  type Bounds3, type Quat, type RigidTransform, type Vec2, type Vec3,
} from './math.js';
import { repeatLevels } from './sites.js';

/** What a placement supplies when a part is resolved. */
export type PartInput = {
  /** Key of the variant; without it the first variant of the definition applies. */
  variant?: string;
  /** Values for placement-scope parameters. */
  values?: Readonly<Record<string, number>>;
  /** Values for state-scope parameters (door open, curtain open). */
  state?: Readonly<Record<string, number>>;
};

/** A variant plus values for parameters of any scope: how a parent part or the validator sets a part up. */
export type PartConfiguration = { variant?: string; values?: Readonly<Record<string, number>> };

type SolidBase = {
  /** Stable path: child instances, then the body key, each with its repeat index: `fuss[1,0]/rohr`. */
  id: string;
  /** Child instances from the resolved part down to the part that owns the body. */
  path: string[];
  /** Body key in the owning definition. */
  body: string;
  /** Repeat indices of the body, outermost level first. */
  index: number[];
  /** Definition that owns the body. */
  part: PartRef;
  material: string;
  label?: string;
};

/** Oriented box: `size` lies along the axes of `rotation`, centred on `center`. */
export type ResolvedBox = SolidBase & { kind: 'box'; center: Vec3; size: Vec3; rotation: Quat };

/**
 * A beam is an oriented box whose local +Y runs from `from` to `to`; `size.x` is the section
 * width, `size.y` the length and `size.z` the section height.
 */
export type ResolvedBeam = SolidBase & {
  kind: 'beam'; center: Vec3; size: Vec3; rotation: Quat; from: Vec3; to: Vec3; length: number;
};

export type ResolvedOpening = {
  key: string;
  shape: SheetHole['shape'];
  /** Counter-clockwise loop as authored, in sheet coordinates. */
  points: Vec2[];
  bounds: { x: number; y: number; width: number; height: number };
  /** `edge`: the cut-out reaches the sheet edge and became a notch of the outline. */
  placement: 'inside' | 'edge';
};

/**
 * A sheet in its own frame: `origin` and `rotation` map sheet coordinates (u, v, w) into the
 * part. The outline lies in the u-v plane and the material spans w from 0 (front face) to
 * `thickness` (back face).
 */
export type ResolvedSheet = SolidBase & {
  kind: 'sheet'; origin: Vec3; rotation: Quat; thickness: number;
  /** Counter-clockwise; cut-outs that reach the edge are already notched in. */
  outline: Vec2[];
  /** Clockwise loops strictly inside the outline. */
  holes: Vec2[][];
  /** Every cut-out that was applied, as authored. */
  openings: ResolvedOpening[];
  /** Bounding size of the authored outline: the piece to cut before the cut-outs. */
  blank: { width: number; height: number };
  netAreaMm2: number;
  grossAreaMm2: number;
};

export type ResolvedSolid = ResolvedBox | ResolvedBeam | ResolvedSheet;

/** A flat face: the point for outline coordinates (x, y) is `origin + u·x + v·y`. */
export type FacePlane = { origin: Vec3; u: Vec3; v: Vec3; normal: Vec3; outline: Vec2[]; holes: Vec2[][] };

export type ResolvedFace = {
  /** Face key of the trait, prefixed with the child instance path: `tuer/front`. */
  key: string;
  label: string;
  /** Id of the solid the face belongs to; a repeated body yields one face per instance. */
  solid: string;
  body: string;
  side: PartFaceSide;
  areaMm2: number;
  /** Absent for `edge` and `all`, which are not one plane. */
  plane?: FacePlane;
};

/** Walkable top of a solid: plan polygon (x, y = part z) and its height above the part origin. */
export type ResolvedSurface = { solid: string; outline: Vec2[]; holes: Vec2[][]; elevation: number };

export type ResolvedConnector = {
  /** Connector key prefixed with the child instance path. */
  id: string;
  key: string;
  /** Child instances down to the part that declares the connector; empty for the part itself. */
  path: string[];
  kind: string;
  partner?: string;
  label?: string;
  position: Vec3;
  /** Unit vector. */
  axis: Vec3;
  /** Extent along `axis` from `position`; 0 for a point connector. */
  length: number;
};

export type BeamCut = {
  material: string; section: { width: number; height: number };
  /** Rounded to whole millimetres; rows group by it. */
  lengthMm: number;
  count: number;
  /** Sum of the exact lengths. */
  totalLengthMm: number;
  weightKg: number;
};

export type SheetCut = {
  material: string; thicknessMm: number;
  /** Bounding size of the outline, rounded to whole millimetres; rows group by it. */
  widthMm: number; heightMm: number;
  count: number;
  /** Net area: outline minus cut-outs, summed over the row. */
  areaMm2: number;
  grossAreaMm2: number;
  weightKg: number;
};

export type HardwareTotal = { material: string; quantity: number; weightKg: number };

/** One child part instance, with its own children. */
export type PartInstance = {
  /** Instance path from the resolved part: `modul[1]/fuss[0,1]`. */
  id: string;
  key: string;
  index: number[];
  part: PartRef;
  name: string;
  /** Variant the instance's values stand for; absent when the definition has none or none fits. */
  variant?: string;
  values: Record<string, number>;
  stock: StockMode;
  parts: PartInstance[];
};

/** Child instances of one part and variant, counted over the whole tree. */
export type PartCount = {
  part: PartRef; name: string; variant?: string;
  /** Values of the variant-scope parameters. */
  variantValues: Record<string, number>;
  stock: StockMode;
  count: number;
};

export type ResolvedPart = {
  part: PartRef;
  name: string;
  category: string;
  variant?: string;
  /** Every parameter with the value used, after defaults, variant, placement and state. */
  values: Record<string, number>;
  derived: Record<string, number>;
  stock: StockMode;
  planSymbol: NonNullable<PartTraits['planSymbol']>;
  /** All bodies of the part and its children, in part-local millimetres. */
  solids: ResolvedSolid[];
  /**
   * Plan outline (x, y = part z): the convex hull of all solids projected to the floor,
   * counter-clockwise from the corner with the smallest y. Concave parts are over-covered.
   */
  footprint: Vec2[];
  bounds: Bounds3;
  /** Top of the highest solid above the supporting surface. */
  height: number;
  faces: ResolvedFace[];
  surfaces: ResolvedSurface[];
  connectors: ResolvedConnector[];
  cutList: { beams: BeamCut[]; sheets: SheetCut[] };
  hardware: HardwareTotal[];
  weightKg: number;
  parts: PartInstance[];
  partCounts: PartCount[];
  issues: PartIssue[];
};

type FaceBinding = { key: string; label: string; solid: string; body: string; side: PartFaceSide };
type RawBeam = { material: string; width: number; height: number; length: number; kgPerM: number };
type RawSheet = { material: string; thickness: number; width: number; height: number; net: number; gross: number; kgPerM2: number };
type RawHardware = { material: string; quantity: number; kgPerPiece: number };

type Node = {
  definition: PartDefinition;
  variant?: string;
  values: Record<string, number>;
  derived: Record<string, number>;
  solids: ResolvedSolid[];
  faces: FaceBinding[];
  surfaces: string[];
  connectors: ResolvedConnector[];
  beams: RawBeam[];
  sheets: RawSheet[];
  hardware: RawHardware[];
  parts: PartInstance[];
  issues: PartIssue[];
  /** Levels of child parts below this node. */
  levels: number;
  issuesReported: boolean;
};

type Run = { context: PartContext; memo: Map<string, Node> };

class Issues {
  readonly list: PartIssue[] = [];
  private readonly seen = new Set<string>();
  add(item: PartIssue) {
    const key = [item.code, item.path, item.body, item.hole, item.child, item.connector, item.hardware, item.parameter,
      item.derived, item.variant, item.material, item.face, item.field].join('|');
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(item);
  }
  /** Derived values that could not be computed; formulas that read them are skipped without a second report. */
  readonly failed = new Set<string>();
  error(code: PartIssue['code'], subject: PartIssueSubject, text: string) { this.add(issue('error', code, subject, text)); }
  warning(code: PartIssue['code'], subject: PartIssueSubject, text: string) { this.add(issue('warning', code, subject, text)); }
}

type Scope = Map<string, number>;

function evaluate(formula: Formula, scope: Scope, subject: PartIssueSubject, issues: Issues): number | undefined {
  try {
    if (typeof formula === 'number') return formula;
    const node = parseFormula(formula);
    if (issues.failed.size && formulaIdentifiers(node).some(name => issues.failed.has(name))) return undefined;
    return evaluateFormula(node, scope);
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    issues.add(formulaIssue(subject, formula, error));
    return undefined;
  }
}

function evaluateList<T extends readonly Formula[]>(
  formulas: T, scope: Scope, subject: PartIssueSubject, field: string, issues: Issues,
): { [K in keyof T]: number } | undefined {
  const values = formulas.map((formula, index) => evaluate(formula, scope, { ...subject, field: `${field}[${index}]` }, issues));
  return values.every(value => value !== undefined) ? values as { [K in keyof T]: number } : undefined;
}

function evaluateVec3(
  formulas: FormulaVec3 | undefined, scope: Scope, subject: PartIssueSubject, field: string, issues: Issues,
): Vec3 | undefined {
  if (!formulas) return undefined;
  const values = evaluateList(formulas, scope, subject, field, issues);
  return values && { x: values[0], y: values[1], z: values[2] };
}

function withinReach(points: readonly Vec3[], subject: PartIssueSubject, issues: Issues): boolean {
  const reach = points.every(point => Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) <= MAX_PART_COORDINATE_MM);
  if (!reach) {
    issues.error('out-of-range', subject, `liegt weiter als ${formatNumber(MAX_PART_COORDINATE_MM)} mm vom Ursprung entfernt.`);
  }
  return reach;
}

function tooSmall(value: number, what: string, subject: PartIssueSubject, issues: Issues): boolean {
  if (value >= MIN_BODY_DIMENSION_MM) return false;
  issues.error('body-too-small', subject,
    `${what} ${formatNumber(value)} mm unterschreitet das Mindestmaß von ${MIN_BODY_DIMENSION_MM} mm.`);
  return true;
}

const instanceId = (key: string, index: readonly number[]) => index.length ? `${key}[${index.join(',')}]` : key;

function forEachInstance(
  repeat: PartRepeat | undefined, scope: Scope, subject: PartIssueSubject, issues: Issues,
  visit: (scope: Scope, index: number[], offset: Vec3) => void,
) {
  const levels = repeatLevels(repeat);
  const descend = (level: number, current: Scope, index: number[], offset: Vec3) => {
    const spec = levels[level];
    if (!spec) { visit(current, index, offset); return; }
    const countSubject = { ...subject, field: `repeat[${level}].count` };
    const raw = evaluate(spec.count, current, countSubject, issues);
    const step = evaluateVec3(spec.step, current, subject, `repeat[${level}].step`, issues);
    if (raw === undefined || !step) return;
    let count = Math.round(raw);
    if (Math.abs(raw - count) > 1e-9) {
      issues.warning('repeat-count', countSubject, `Die Anzahl ${formatNumber(raw)} ist keine ganze Zahl und wird auf ${count} gerundet.`);
    }
    if (count > PART_LIMITS.repeatCount) {
      issues.error('repeat-count', countSubject, `Die Anzahl ${count} übersteigt das Höchstmaß von ${PART_LIMITS.repeatCount}.`);
      count = PART_LIMITS.repeatCount;
    }
    for (let position = 0; position < count; position++) {
      descend(level + 1, new Map(current).set(spec.index, position), [...index, position], add(offset, scale(step, position)));
    }
  };
  descend(0, scope, [], { ...VEC3_ZERO });
}

/** Rotation about `pivot` (default `at`): where `at` ends up, and the rotation itself. */
function pose(
  body: { at: FormulaVec3; rotation?: FormulaVec3; pivot?: FormulaVec3 },
  scope: Scope, subject: PartIssueSubject, issues: Issues,
): RigidTransform | undefined {
  const at = evaluateVec3(body.at, scope, subject, 'at', issues);
  const angles = body.rotation ? evaluateVec3(body.rotation, scope, subject, 'rotation', issues) : { ...VEC3_ZERO };
  const pivot = body.pivot ? evaluateVec3(body.pivot, scope, subject, 'pivot', issues) : at;
  if (!at || !angles || !pivot) return undefined;
  const rotation = quatFromEulerDegrees(angles.x, angles.y, angles.z);
  return { rotation, translation: add(pivot, rotate(rotation, sub(at, pivot))) };
}

/**
 * Frame of a beam: local +Y along the centre line. The section width stays horizontal and the
 * section height stands as upright as it can; a vertical beam keeps width along +X and height
 * along Z.
 */
export function beamRotation(from: Vec3, to: Vec3, rollDegrees = 0): Quat {
  const direction = normalize(sub(to, from));
  let widthAxis: Vec3 = { x: 1, y: 0, z: 0 };
  if (Math.hypot(direction.x, direction.z) > 1e-9) {
    widthAxis = normalize({ x: direction.z, y: 0, z: -direction.x });
    if (widthAxis.x < -1e-9 || (Math.abs(widthAxis.x) <= 1e-9 && widthAxis.z < 0)) widthAxis = scale(widthAxis, -1);
  }
  const frame = quatFromBasis(widthAxis, direction, cross(widthAxis, direction));
  return rollDegrees ? quatMultiply(frame, quatFromAxisAngle({ x: 0, y: 1, z: 0 }, rollDegrees * Math.PI / 180)) : frame;
}

const PLANE_ROTATION: Record<SheetBody['plane'], Quat> = {
  xy: QUAT_IDENTITY,
  xz: quatFromEulerDegrees(90, 0, 0),
  yz: quatFromEulerDegrees(0, -90, 0),
};
const ANCHOR_OFFSET: Record<NonNullable<SheetBody['anchor']>, number> = { face: 0, centre: -0.5, back: -1 };

/** Segments of the semicircular crown of an arch cut-out. */
export function archSegmentCount(radius: number): number {
  return Math.max(12, Math.min(48, Math.ceil(Math.PI * radius / 40)));
}

function rectPoints(x: number, y: number, width: number, height: number): Vec2[] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

function archPoints(x: number, y: number, width: number, height: number): Vec2[] {
  const radius = width / 2;
  const spring = y + height - radius;
  const points = [{ x, y }, { x: x + width, y }, { x: x + width, y: spring }];
  const count = archSegmentCount(radius);
  for (let i = 1; i < count; i++) {
    const angle = Math.PI * (i / count);
    points.push({ x: x + radius + radius * Math.cos(angle), y: spring + radius * Math.sin(angle) });
  }
  points.push({ x, y: spring });
  // An arch that is all crown has no jambs: its springing points fall onto the sill corners.
  return cleanPolygon(points);
}

function evaluatePoints(
  points: readonly FormulaVec2[], scope: Scope, subject: PartIssueSubject, field: string, issues: Issues,
): Vec2[] | undefined {
  const result: Vec2[] = [];
  for (let index = 0; index < points.length; index++) {
    const values = evaluateList(points[index]!, scope, subject, `${field}[${index}]`, issues);
    if (!values) return undefined;
    result.push({ x: values[0], y: values[1] });
  }
  return result;
}

function evaluateRect(
  rect: { x: Formula; y: Formula; width: Formula; height: Formula },
  scope: Scope, subject: PartIssueSubject, prefix: string, issues: Issues,
): { x: number; y: number; width: number; height: number } | undefined {
  const field = (name: string) => ({ ...subject, field: `${prefix}${name}` });
  const x = evaluate(rect.x, scope, field('x'), issues), y = evaluate(rect.y, scope, field('y'), issues);
  const width = evaluate(rect.width, scope, field('width'), issues), height = evaluate(rect.height, scope, field('height'), issues);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  const small = [tooSmall(width, 'Breite', field('width'), issues), tooSmall(height, 'Höhe', field('height'), issues)];
  return small.some(Boolean) ? undefined : { x, y, width, height };
}

/** Repeated points and points on a straight run carry no shape; without them every outline point is a corner. */
const cleanLoop = (points: Vec2[] | undefined): Vec2[] | undefined => points && cleanPolygon(points);

function validLoop(points: Vec2[], subject: PartIssueSubject, issues: Issues): boolean {
  const bounds = polygonBounds(points);
  if (!isSimplePolygon(points) || polygonArea(points) < MIN_BODY_DIMENSION_MM) {
    issues.error('outline-invalid', subject, 'Die Kontur überschneidet sich selbst oder schließt keine Fläche ein.');
    return false;
  }
  return ![tooSmall(bounds.width, 'Breite', subject, issues), tooSmall(bounds.height, 'Höhe', subject, issues)].some(Boolean);
}

type Cut = { key: string; shape: SheetHole['shape']; points: Vec2[] };

function strictlyInside(outline: readonly Vec2[], loop: readonly Vec2[]): boolean {
  if (!loop.every(point => pointInPolygon(point, outline) && distanceToBoundary(point, outline) > FLUSH_EPS_MM)) return false;
  for (let i = 0; i < loop.length; i++) {
    for (let j = 0; j < outline.length; j++) {
      if (segmentsTouch(loop[i]!, loop[(i + 1) % loop.length]!, outline[j]!, outline[(j + 1) % outline.length]!)) return false;
    }
  }
  return true;
}

/** Cut-outs inside the outline stay holes; those that reach the edge are subtracted as notches. */
function applyCuts(outline: Vec2[], cuts: Cut[], body: string, issues: Issues) {
  let current = outline;
  let inside: Cut[] = [];
  const applied = new Map<string, 'inside' | 'edge'>();
  const queue = [...cuts];
  for (let cut = queue.shift(); cut; cut = queue.shift()) {
    const subject = { body, hole: cut.key };
    if (strictlyInside(current, cut.points)) {
      if (inside.some(other => loopsOverlap(other.points, cut.points))) {
        issues.error('hole-overlap', subject, 'überschneidet oder berührt einen anderen Ausschnitt; bitte zu einem Ausschnitt zusammenfassen.');
        continue;
      }
      inside.push(cut);
      applied.set(cut.key, 'inside');
      continue;
    }
    const result = subtractPolygon(current, cut.points);
    if (result.kind === 'apart') {
      issues.warning('hole-outside', subject, 'liegt außerhalb der Platte und bleibt ohne Wirkung.');
    } else if (result.kind === 'removed') {
      issues.error('hole-covers-sheet', subject, 'entfernt die ganze Platte.');
    } else if (result.kind === 'degenerate' || !result.polygons.every(isSimplePolygon)) {
      issues.error('hole-unsupported', subject, 'berührt die Kontur nur mit einer Ecke oder trifft sie genau in einer Ecke; bitte den Ausschnitt leicht verschieben.');
    } else if (result.polygons.length !== 1) {
      issues.error('hole-splits-sheet', subject, 'teilt die Platte in mehrere Stücke; bitte dafür getrennte Platten anlegen.');
    } else {
      current = result.polygons[0]!;
      applied.set(cut.key, 'edge');
      const outlineNow = current;
      const displaced = inside.filter(other => !strictlyInside(outlineNow, other.points));
      inside = inside.filter(other => !displaced.includes(other));
      for (const other of displaced) applied.delete(other.key);
      queue.unshift(...displaced);
    }
  }
  return { outline: current, holes: inside.map(cut => withWinding(cut.points, false)), applied };
}

type NodeBuilder = Omit<Node, 'issues' | 'issuesReported'> & { issues: Issues };

function materialFor(
  body: PartBody, context: PartContext, issues: Issues,
): PartMaterial | undefined {
  const subject = { body: body.key, material: body.material };
  const material = context.material(body.material);
  if (!material) {
    issues.error('unknown-material', subject, `Das Material „${body.material}“ ist nicht vorhanden.`);
    return undefined;
  }
  const expected = BODY_MATERIAL_KIND[body.kind];
  if (material.kind !== expected) {
    issues.error('material-kind', subject,
      `Das Material „${material.name}“ ist ${MATERIAL_KIND_LABELS[material.kind]}, gebraucht wird ${MATERIAL_KIND_LABELS[expected]}.`);
    return undefined;
  }
  return material;
}

function solidBase(node: NodeBuilder, body: PartBody, index: number[]): SolidBase {
  const { id, revision } = node.definition;
  return {
    id: instanceId(body.key, index), path: [], body: body.key, index, part: { id, revision },
    material: body.material, ...(body.label ? { label: body.label } : {}),
  };
}

function resolveBox(node: NodeBuilder, body: BoxBody, material: PartMaterial | undefined, scope: Scope, index: number[], offset: Vec3) {
  const subject = { body: body.key };
  const size = evaluateVec3(body.size, scope, subject, 'size', node.issues);
  const placed = pose(body, scope, subject, node.issues);
  if (!size || !placed) return;
  const small = [
    tooSmall(size.x, 'Breite', { ...subject, field: 'size[0]' }, node.issues),
    tooSmall(size.y, 'Höhe', { ...subject, field: 'size[1]' }, node.issues),
    tooSmall(size.z, 'Tiefe', { ...subject, field: 'size[2]' }, node.issues),
  ];
  const center = add(placed.translation, offset);
  if (small.some(Boolean) || !withinReach([center, size], subject, node.issues)) return;
  node.solids.push({ ...solidBase(node, body, index), kind: 'box', center, size, rotation: placed.rotation });
  if (material?.kind === 'hardware') node.hardware.push({ material: material.key, quantity: 1, kgPerPiece: material.weightKgPerPiece });
}

function resolveBeam(node: NodeBuilder, body: BeamBody, material: PartMaterial | undefined, scope: Scope, index: number[], offset: Vec3) {
  const subject = { body: body.key };
  const start = evaluateVec3(body.from, scope, subject, 'from', node.issues);
  const end = evaluateVec3(body.to, scope, subject, 'to', node.issues);
  const override = body.section ? evaluateList(body.section, scope, subject, 'section', node.issues) : undefined;
  const roll = body.roll === undefined ? 0 : evaluate(body.roll, scope, { ...subject, field: 'roll' }, node.issues);
  if (!start || !end || roll === undefined || (body.section && !override)) return;
  const profile = material?.kind === 'profile' ? material : undefined;
  const section = override ? { width: override[0], height: override[1] } : profile?.section;
  if (!section) return;
  const from = add(start, offset), to = add(end, offset);
  const span = length(sub(to, from));
  const small = [
    tooSmall(span, 'Länge', { ...subject, field: 'to' }, node.issues),
    tooSmall(section.width, 'Querschnittsbreite', { ...subject, field: 'section[0]' }, node.issues),
    tooSmall(section.height, 'Querschnittshöhe', { ...subject, field: 'section[1]' }, node.issues),
  ];
  if (small.some(Boolean) || !withinReach([from, to], subject, node.issues)) return;
  node.solids.push({
    ...solidBase(node, body, index), kind: 'beam',
    center: scale(add(from, to), 0.5), size: { x: section.width, y: span, z: section.height },
    rotation: beamRotation(from, to, roll), from, to, length: span,
  });
  if (profile) node.beams.push({ material: profile.key, width: section.width, height: section.height, length: span, kgPerM: profile.weightKgPerM });
}

function resolveSheet(node: NodeBuilder, body: SheetBody, material: PartMaterial | undefined, scope: Scope, index: number[], offset: Vec3) {
  const subject = { body: body.key };
  const issues = node.issues;
  const stock = material?.kind === 'sheet' ? material : undefined;
  const thickness = body.thickness === undefined ? stock?.thickness : evaluate(body.thickness, scope, { ...subject, field: 'thickness' }, issues);
  const placed = pose(body, scope, subject, issues);
  let authored: Vec2[] | undefined;
  if (body.outline.shape === 'rect') {
    const rect = evaluateRect(body.outline, scope, subject, 'outline.', issues);
    authored = rect && rectPoints(rect.x, rect.y, rect.width, rect.height);
  } else {
    const points = cleanLoop(evaluatePoints(body.outline.points, scope, subject, 'outline.points', issues));
    authored = points && validLoop(points, { ...subject, field: 'outline' }, issues) ? withWinding(points, true) : undefined;
  }
  if (thickness === undefined || !placed || !authored) return;
  if (tooSmall(thickness, 'Stärke', { ...subject, field: 'thickness' }, issues)) return;

  const cuts: Cut[] = [];
  for (const hole of body.holes ?? []) {
    const holeSubject = { ...subject, hole: hole.key };
    if (hole.when !== undefined) {
      const active = evaluate(hole.when, scope, { ...holeSubject, field: 'when' }, issues);
      if (!active) continue;
    }
    if (hole.shape === 'polygon') {
      const points = cleanLoop(evaluatePoints(hole.points, scope, holeSubject, 'points', issues));
      if (points && validLoop(points, holeSubject, issues)) cuts.push({ key: hole.key, shape: hole.shape, points: withWinding(points, true) });
      continue;
    }
    const rect = evaluateRect(hole, scope, holeSubject, '', issues);
    if (!rect) continue;
    if (hole.shape === 'arch' && rect.height < rect.width / 2) {
      issues.error('outline-invalid', holeSubject,
        `Ein Bogen braucht mindestens die halbe Breite als Höhe (${formatNumber(rect.height)} mm bei ${formatNumber(rect.width)} mm Breite).`);
      continue;
    }
    cuts.push({
      key: hole.key, shape: hole.shape,
      points: hole.shape === 'arch' ? archPoints(rect.x, rect.y, rect.width, rect.height) : rectPoints(rect.x, rect.y, rect.width, rect.height),
    });
  }
  const cut = applyCuts(authored, cuts, body.key, issues);

  const rotation = quatMultiply(placed.rotation, PLANE_ROTATION[body.plane]);
  const normal = rotate(rotation, { x: 0, y: 0, z: 1 });
  const origin = add(add(placed.translation, offset), scale(normal, ANCHOR_OFFSET[body.anchor ?? 'face'] * thickness));
  const blank = polygonBounds(authored);
  if (!withinReach([origin, { x: blank.width, y: blank.height, z: thickness }], subject, issues)) return;
  const gross = polygonArea(authored);
  const net = polygonArea(cut.outline) - cut.holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
  node.solids.push({
    ...solidBase(node, body, index), kind: 'sheet', origin, rotation, thickness,
    outline: cut.outline, holes: cut.holes,
    openings: cuts.filter(item => cut.applied.has(item.key)).map(item => {
      const bounds = polygonBounds(item.points);
      return {
        key: item.key, shape: item.shape, points: item.points,
        bounds: { x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height },
        placement: cut.applied.get(item.key)!,
      };
    }),
    blank: { width: blank.width, height: blank.height }, netAreaMm2: net, grossAreaMm2: gross,
  });
  if (stock) {
    node.sheets.push({ material: stock.key, thickness, width: blank.width, height: blank.height, net, gross, kgPerM2: stock.weightKgPerM2 });
  }
}

/** A solid moved by a rigid transform. */
export function transformSolid<T extends ResolvedSolid>(solid: T, transform: RigidTransform): T {
  const rotation = quatMultiply(transform.rotation, solid.rotation);
  if (solid.kind === 'sheet') return { ...solid, origin: applyTransform(transform, solid.origin), rotation };
  const moved = { ...solid, center: applyTransform(transform, solid.center), rotation };
  return solid.kind === 'beam'
    ? { ...moved, from: applyTransform(transform, solid.from), to: applyTransform(transform, solid.to) }
    : moved;
}

export function transformConnector(connector: ResolvedConnector, transform: RigidTransform): ResolvedConnector {
  return { ...connector, position: applyTransform(transform, connector.position), axis: rotate(transform.rotation, connector.axis) };
}

/** Corner points of a solid: eight for a box or beam, two per outline point for a sheet. */
export function solidVertices(solid: ResolvedSolid): Vec3[] {
  if (solid.kind === 'sheet') {
    return solid.outline.flatMap(point => [0, solid.thickness].map(w =>
      add(solid.origin, rotate(solid.rotation, { x: point.x, y: point.y, z: w }))));
  }
  const half = scale(solid.size, 0.5);
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corners.push(add(solid.center, rotate(solid.rotation, { x: sx * half.x, y: sy * half.y, z: sz * half.z })));
  }
  return corners;
}

const rectangle = (width: number, height: number): Vec2[] => rectPoints(-width / 2, -height / 2, width, height);

/** Area of one side of a solid and, for a flat side, its plane. */
export function solidFace(solid: ResolvedSolid, side: PartFaceSide): { areaMm2: number; plane?: FacePlane } | undefined {
  const axes = quatAxes(solid.rotation);
  if (solid.kind === 'sheet') {
    const rim = (polygonPerimeter(solid.outline) + solid.holes.reduce((sum, hole) => sum + polygonPerimeter(hole), 0)) * solid.thickness;
    if (side === 'edge') return { areaMm2: rim };
    if (side === 'all') return { areaMm2: rim + 2 * solid.netAreaMm2 };
    if (side !== 'front' && side !== 'back') return undefined;
    const back = side === 'back';
    return {
      areaMm2: solid.netAreaMm2,
      plane: {
        origin: back ? add(solid.origin, scale(axes.z, solid.thickness)) : solid.origin,
        u: axes.x, v: axes.y, normal: back ? axes.z : scale(axes.z, -1),
        outline: solid.outline, holes: solid.holes,
      },
    };
  }
  const { x, y, z } = solid.size;
  if (side === 'all') return { areaMm2: 2 * (x * y + y * z + x * z) };
  const flat = (u: Vec3, v: Vec3, normal: Vec3, width: number, height: number, depth: number) => ({
    areaMm2: width * height,
    plane: { origin: add(solid.center, scale(normal, depth / 2)), u, v, normal, outline: rectangle(width, height), holes: [] },
  });
  switch (side) {
    case 'front': return flat(axes.x, axes.y, scale(axes.z, -1), x, y, z);
    case 'back': return flat(axes.x, axes.y, axes.z, x, y, z);
    case 'left': return flat(axes.z, axes.y, scale(axes.x, -1), z, y, x);
    case 'right': return flat(axes.z, axes.y, axes.x, z, y, x);
    case 'top': return flat(axes.x, axes.z, axes.y, x, z, y);
    case 'bottom': return flat(axes.x, axes.z, scale(axes.y, -1), x, z, y);
    case 'edge': return undefined;
  }
}

const HORIZONTAL = 1 - 1e-6;

/** The upward face of a solid as a plan polygon, or `undefined` when no face is level. */
export function solidTopSurface(solid: ResolvedSolid): ResolvedSurface | undefined {
  const axes = quatAxes(solid.rotation);
  const plan = (point: Vec3): Vec2 => ({ x: point.x, y: point.z });
  if (solid.kind === 'sheet') {
    if (Math.abs(axes.z.y) < HORIZONTAL) return undefined;
    const top = axes.z.y > 0 ? add(solid.origin, scale(axes.z, solid.thickness)) : solid.origin;
    const loop = (points: readonly Vec2[]) => points.map(point => plan(add(top, add(scale(axes.x, point.x), scale(axes.y, point.y)))));
    return {
      solid: solid.id, elevation: top.y,
      outline: withWinding(loop(solid.outline), true), holes: solid.holes.map(hole => withWinding(loop(hole), false)),
    };
  }
  const sides = [
    { up: axes.x, a: axes.y, b: axes.z, extent: solid.size.x, width: solid.size.y, depth: solid.size.z },
    { up: axes.y, a: axes.x, b: axes.z, extent: solid.size.y, width: solid.size.x, depth: solid.size.z },
    { up: axes.z, a: axes.x, b: axes.y, extent: solid.size.z, width: solid.size.x, depth: solid.size.y },
  ];
  const level = sides.find(side => Math.abs(side.up.y) >= HORIZONTAL);
  if (!level) return undefined;
  const corners = rectangle(level.width, level.depth).map(point =>
    plan(add(solid.center, add(scale(level.a, point.x), scale(level.b, point.y)))));
  return { solid: solid.id, elevation: solid.center.y + level.extent / 2, outline: withWinding(corners, true), holes: [] };
}

function resolveValues(definition: PartDefinition, configuration: PartConfiguration, issues: Issues) {
  const values: Record<string, number> = {};
  const parameters = new Map(definition.parameters.map(parameter => [parameter.key, parameter]));
  for (const parameter of definition.parameters) values[parameter.key] = parameter.default;

  const variants = definition.variants ?? [];
  let chosen = variants[0];
  if (configuration.variant !== undefined) {
    const named = variants.find(variant => variant.key === configuration.variant);
    if (named) chosen = named;
    else {
      issues.error('unknown-variant', { variant: configuration.variant }, variants.length
        ? `gibt es bei „${definition.name}“ nicht; verwendet wird „${chosen!.label}“.`
        : `„${definition.name}“ hat keine Varianten.`);
    }
  }
  Object.assign(values, variantValues(definition, chosen));

  let variantChanged = false;
  for (const [key, input] of Object.entries(configuration.values ?? {})) {
    const parameter = parameters.get(key);
    if (!parameter) {
      issues.warning('unknown-parameter', { parameter: key }, `ist bei „${definition.name}“ nicht definiert und wird ignoriert.`);
      continue;
    }
    const value = normalizeParameterValue(parameter, input);
    if (!(Math.abs(value - input) <= 1e-9)) {
      issues.warning('value-adjusted', { parameter: key },
        `Der Wert ${formatNumber(input)} ist nicht zulässig; verwendet wird ${formatNumber(value)}.`);
    }
    if (parameter.scope === 'variant' && Math.abs(value - values[key]!) > 1e-9) variantChanged = true;
    values[key] = value;
  }

  let variant = chosen?.key;
  if (variants.length && variantChanged) {
    variant = matchVariant(definition, values)?.key;
    if (!variant) {
      const set = definition.parameters.filter(parameter => parameter.scope === 'variant')
        .map(parameter => `${parameter.key} = ${formatNumber(values[parameter.key]!)}`).join(', ');
      issues.error('variant-unmatched', {}, `Für ${set} gibt es bei „${definition.name}“ keine Variante.`);
    }
  }
  return { values, variant };
}

function hasRoom(node: NodeBuilder, added: number): boolean {
  if (node.solids.length + added <= PART_LIMITS.solids) return true;
  node.issues.error('too-many-solids', {}, `Das Bauteil hat mehr als ${PART_LIMITS.solids} Körper; der Rest fehlt.`);
  return false;
}

function lift(node: Node, prefix: string, key: string, index: number[], transform: RigidTransform, into: NodeBuilder) {
  if (!hasRoom(into, node.solids.length)) return;
  const qualify = (id: string) => `${prefix}/${id}`;
  for (const solid of node.solids) {
    into.solids.push({ ...transformSolid(solid, transform), id: qualify(solid.id), path: [prefix, ...solid.path] });
  }
  for (const face of node.faces) into.faces.push({ ...face, key: qualify(face.key), solid: qualify(face.solid) });
  for (const solid of node.surfaces) into.surfaces.push(qualify(solid));
  for (const connector of node.connectors) {
    into.connectors.push({ ...transformConnector(connector, transform), id: qualify(connector.id), path: [prefix, ...connector.path] });
  }
  into.beams.push(...node.beams);
  into.sheets.push(...node.sheets);
  into.hardware.push(...node.hardware);
  const requalify = (instance: PartInstance): PartInstance => ({ ...instance, id: qualify(instance.id), parts: instance.parts.map(requalify) });
  const { id, revision, name } = node.definition;
  into.parts.push({
    id: prefix, key, index, part: { id, revision }, name,
    ...(node.variant !== undefined ? { variant: node.variant } : {}),
    values: node.values, stock: node.definition.traits.stock, parts: node.parts.map(requalify),
  });
  if (!node.issuesReported) {
    node.issuesReported = true;
    for (const item of node.issues) {
      into.issues.add({ ...item, path: item.path ? qualify(item.path) : prefix, message: `Unterbauteil „${prefix}“ → ${item.message}` });
    }
  }
}

function resolveChild(node: NodeBuilder, child: PartChild, scope: Scope, index: number[], offset: Vec3, run: Run, stack: string[]) {
  const subject = { child: child.key };
  const issues = node.issues;
  const placed = pose(child, scope, subject, issues);
  const values: Record<string, number> = {};
  let complete = !!placed;
  for (const [key, formula] of Object.entries(child.values ?? {})) {
    const value = evaluate(formula, scope, { ...subject, field: `values.${key}` }, issues);
    if (value === undefined) complete = false;
    else values[key] = value;
  }
  if (!placed || !complete) return;
  const definition = run.context.part(child.part);
  if (!definition) {
    issues.error('unknown-part', subject, `Das Bauteil ${child.part.id} (Revision ${child.part.revision}) ist nicht vorhanden.`);
    return;
  }
  if (stack.includes(definition.id)) {
    issues.error('child-cycle', subject, `„${definition.name}“ enthält sich selbst.`);
    return;
  }
  if (stack.length > PART_LIMITS.depth) {
    issues.error('child-depth', subject, `Unterbauteile sind tiefer als ${PART_LIMITS.depth} Ebenen verschachtelt.`);
    return;
  }
  const resolved = resolveNode(definition, { variant: child.variant, values }, run, [...stack, definition.id]);
  if (stack.length + resolved.levels > PART_LIMITS.depth) {
    issues.error('child-depth', subject, `Unterbauteile sind tiefer als ${PART_LIMITS.depth} Ebenen verschachtelt.`);
    return;
  }
  node.levels = Math.max(node.levels, resolved.levels + 1);
  const transform = { rotation: placed.rotation, translation: add(placed.translation, offset) };
  if (!withinReach([transform.translation], subject, issues)) return;
  lift(resolved, instanceId(child.key, index), child.key, index, transform, node);
}

function resolveNode(definition: PartDefinition, configuration: PartConfiguration, run: Run, stack: string[]): Node {
  const memoKey = JSON.stringify([
    partRefKey(definition), configuration.variant ?? null,
    Object.entries(configuration.values ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ]);
  const known = run.memo.get(memoKey);
  if (known) return known;

  const issues = new Issues();
  const { values, variant } = resolveValues(definition, configuration, issues);
  const scope: Scope = new Map(Object.entries(values));
  const derived: Record<string, number> = {};
  for (const item of definition.derived ?? []) {
    const value = evaluate(item.formula, scope, { derived: item.key }, issues);
    if (value === undefined) {
      issues.failed.add(item.key);
      continue;
    }
    derived[item.key] = value;
    scope.set(item.key, value);
  }
  const node: NodeBuilder = {
    definition, values, derived, ...(variant !== undefined ? { variant } : {}),
    solids: [], faces: [], surfaces: [], connectors: [], beams: [], sheets: [], hardware: [], parts: [], issues, levels: 0,
  };

  const room = () => hasRoom(node, 1);

  for (const body of definition.bodies) {
    const material = materialFor(body, run.context, issues);
    forEachInstance(body.repeat, scope, { body: body.key }, issues, (instanceScope, index, offset) => {
      if (body.when !== undefined && !evaluate(body.when, instanceScope, { body: body.key, field: 'when' }, issues)) return;
      if (!room()) return;
      if (body.kind === 'box') resolveBox(node, body, material, instanceScope, index, offset);
      else if (body.kind === 'beam') resolveBeam(node, body, material, instanceScope, index, offset);
      else resolveSheet(node, body, material, instanceScope, index, offset);
    });
  }

  for (const face of definition.traits.faces ?? []) {
    for (const solid of node.solids) {
      if (solid.body === face.body) node.faces.push({ key: face.key, label: face.label, solid: solid.id, body: face.body, side: face.side });
    }
  }
  const walkable = definition.traits.surface?.body;
  if (walkable !== undefined) {
    for (const solid of node.solids) if (solid.body === walkable) node.surfaces.push(solid.id);
  }

  for (const connector of definition.connectors ?? []) {
    const subject = { connector: connector.key };
    if (connector.when !== undefined && !evaluate(connector.when, scope, { ...subject, field: 'when' }, issues)) continue;
    const position = evaluateVec3(connector.at, scope, subject, 'at', issues);
    const direction = evaluateVec3(connector.axis, scope, subject, 'axis', issues);
    const extent = connector.length === undefined ? 0 : evaluate(connector.length, scope, { ...subject, field: 'length' }, issues);
    if (!position || !direction || extent === undefined) continue;
    if (!(length(direction) > 1e-9)) {
      issues.error('connector-axis', { ...subject, field: 'axis' }, 'Die Richtung hat die Länge null.');
      continue;
    }
    node.connectors.push({
      id: connector.key, key: connector.key, path: [], kind: connector.kind,
      ...(connector.partner ? { partner: connector.partner } : {}), ...(connector.label ? { label: connector.label } : {}),
      position, axis: normalize(direction), length: Math.max(0, extent),
    });
  }

  for (const item of definition.hardware ?? []) {
    const subject = { hardware: item.material };
    if (item.when !== undefined && !evaluate(item.when, scope, { ...subject, field: 'when' }, issues)) continue;
    const raw = evaluate(item.quantity, scope, { ...subject, field: 'quantity' }, issues);
    if (raw === undefined) continue;
    const material = run.context.material(item.material);
    if (!material) {
      issues.error('unknown-material', { ...subject, material: item.material }, 'Das Material ist nicht vorhanden.');
    } else if (material.kind !== 'hardware') {
      issues.error('material-kind', { ...subject, material: item.material },
        `Das Material „${material.name}“ ist ${MATERIAL_KIND_LABELS[material.kind]}, gebraucht wird ${MATERIAL_KIND_LABELS.hardware}.`);
    }
    if (raw < 0) {
      issues.error('hardware-quantity', { ...subject, field: 'quantity' }, `Die Menge ${formatNumber(raw)} ist negativ.`);
      continue;
    }
    const quantity = Math.ceil(raw - 1e-9);
    if (Math.abs(quantity - raw) > 1e-9) {
      issues.warning('hardware-quantity', { ...subject, field: 'quantity' },
        `Die Menge ${formatNumber(raw)} ist keine ganze Zahl und wird auf ${quantity} aufgerundet.`);
    }
    if (quantity > 0) {
      node.hardware.push({ material: item.material, quantity, kgPerPiece: material?.kind === 'hardware' ? material.weightKgPerPiece : 0 });
    }
  }

  for (const child of definition.children ?? []) {
    forEachInstance(child.repeat, scope, { child: child.key }, issues, (instanceScope, index, offset) => {
      if (child.when !== undefined && !evaluate(child.when, instanceScope, { child: child.key, field: 'when' }, issues)) return;
      if (!room()) return;
      resolveChild(node, child, instanceScope, index, offset, run, stack);
    });
  }

  const result: Node = { ...node, issues: issues.list, issuesReported: false };
  run.memo.set(memoKey, result);
  return result;
}

const snap = (value: number) => {
  const snapped = Math.round(value * 1e6) / 1e6;
  return snapped === 0 ? 0 : snapped;
};
const snapVec3 = (point: Vec3): Vec3 => ({ x: snap(point.x), y: snap(point.y), z: snap(point.z) });
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function cutList(node: Node) {
  const beams = new Map<string, BeamCut>();
  for (const beam of node.beams) {
    const lengthMm = Math.round(beam.length);
    const key = JSON.stringify([beam.material, beam.width, beam.height, lengthMm]);
    const row = beams.get(key) ?? {
      material: beam.material, section: { width: beam.width, height: beam.height }, lengthMm, count: 0, totalLengthMm: 0, weightKg: 0,
    };
    row.count++;
    row.totalLengthMm += beam.length;
    row.weightKg += beam.length / 1000 * beam.kgPerM;
    beams.set(key, row);
  }
  const sheets = new Map<string, SheetCut>();
  for (const sheet of node.sheets) {
    const widthMm = Math.round(sheet.width), heightMm = Math.round(sheet.height);
    const key = JSON.stringify([sheet.material, sheet.thickness, widthMm, heightMm]);
    const row = sheets.get(key) ?? {
      material: sheet.material, thicknessMm: sheet.thickness, widthMm, heightMm, count: 0, areaMm2: 0, grossAreaMm2: 0, weightKg: 0,
    };
    row.count++;
    row.areaMm2 += sheet.net;
    row.grossAreaMm2 += sheet.gross;
    row.weightKg += sheet.net / 1e6 * sheet.kgPerM2;
    sheets.set(key, row);
  }
  const hardware = new Map<string, HardwareTotal>();
  for (const item of node.hardware) {
    const row = hardware.get(item.material) ?? { material: item.material, quantity: 0, weightKg: 0 };
    row.quantity += item.quantity;
    row.weightKg += item.quantity * item.kgPerPiece;
    hardware.set(item.material, row);
  }
  return {
    beams: [...beams.values()].sort((a, b) => compare(a.material, b.material) || b.lengthMm - a.lengthMm
      || b.section.width - a.section.width || b.section.height - a.section.height),
    sheets: [...sheets.values()].sort((a, b) => compare(a.material, b.material) || b.widthMm - a.widthMm
      || b.heightMm - a.heightMm || b.thicknessMm - a.thicknessMm),
    hardware: [...hardware.values()].sort((a, b) => compare(a.material, b.material)),
  };
}

function countParts(instances: readonly PartInstance[], context: PartContext): PartCount[] {
  const counts = new Map<string, PartCount>();
  const visit = (instance: PartInstance) => {
    const definition = context.part(instance.part);
    const variantScope: Record<string, number> = {};
    for (const parameter of definition?.parameters ?? []) {
      if (parameter.scope === 'variant') variantScope[parameter.key] = instance.values[parameter.key] ?? parameter.default;
    }
    const key = JSON.stringify([partRefKey(instance.part), instance.variant ?? null, variantScope]);
    const row = counts.get(key) ?? {
      part: instance.part, name: instance.name, ...(instance.variant !== undefined ? { variant: instance.variant } : {}),
      variantValues: variantScope, stock: instance.stock, count: 0,
    };
    row.count++;
    counts.set(key, row);
    instance.parts.forEach(visit);
  };
  instances.forEach(visit);
  return [...counts.entries()].sort(([a, rowA], [b, rowB]) => compare(rowA.name, rowB.name) || compare(a, b)).map(([, row]) => row);
}

function resolveFaces(bindings: readonly FaceBinding[], solids: ReadonlyMap<string, ResolvedSolid>): ResolvedFace[] {
  const faces: ResolvedFace[] = [];
  for (const binding of bindings) {
    const solid = solids.get(binding.solid);
    const face = solid && solidFace(solid, binding.side);
    if (face) faces.push({ ...binding, ...face });
  }
  return faces;
}

function finish(node: Node, context: PartContext): ResolvedPart {
  const issues = new Issues();
  node.issues.forEach(item => issues.add(item));
  const { definition } = node;
  const solids = node.solids;
  const byId = new Map(solids.map(solid => [solid.id, solid]));
  const vertices = solids.flatMap(solidVertices);
  const bounds = boundsOf(vertices);
  const surfaces: ResolvedSurface[] = [];
  for (const id of node.surfaces) {
    const solid = byId.get(id)!;
    const surface = solidTopSurface(solid);
    if (surface) surfaces.push(surface);
    else issues.error('surface-not-horizontal', { body: solid.body }, 'ist als begehbare Fläche markiert, liegt aber nicht waagerecht.');
  }
  if (!solids.length && !issues.list.some(item => item.severity === 'error')) {
    issues.warning('empty-part', {}, 'In dieser Einstellung hat das Bauteil keinen Körper.');
  }
  const cuts = cutList(node);
  const weightKg = [...cuts.beams, ...cuts.sheets, ...cuts.hardware].reduce((sum, row) => sum + row.weightKg, 0);
  const { id, revision } = definition;
  return {
    part: { id, revision }, name: definition.name, category: definition.category,
    ...(node.variant !== undefined ? { variant: node.variant } : {}),
    values: node.values, derived: node.derived,
    stock: definition.traits.stock, planSymbol: definition.traits.planSymbol ?? 'footprint',
    solids,
    footprint: convexHull(vertices.map(point => ({ x: point.x, y: point.z }))),
    bounds: { min: snapVec3(bounds.min), max: snapVec3(bounds.max) },
    height: snap(bounds.max.y),
    faces: resolveFaces(node.faces, byId), surfaces, connectors: node.connectors,
    cutList: { beams: cuts.beams, sheets: cuts.sheets }, hardware: cuts.hardware, weightKg,
    parts: node.parts, partCounts: countParts(node.parts, context),
    issues: issues.list,
  };
}

/**
 * Resolve a part with a variant and values for parameters of any scope. Parent parts and
 * `validateDefinition` use this; placements in a Bühnenbild go through `resolvePart`.
 */
export function resolvePartConfiguration(
  definition: PartDefinition, configuration: PartConfiguration, context: PartContext,
): ResolvedPart {
  const run: Run = { context, memo: new Map() };
  return finish(resolveNode(definition, configuration, run, [definition.id]), context);
}

/**
 * Resolve one placement of a part: parameter values, solids in part-local millimetres,
 * footprint, faces, walkable surfaces, connectors, cut list, hardware, weight and child parts.
 * Deterministic. Problems with the supplied values or the definition come back in `issues`;
 * nothing is thrown for them.
 */
export function resolvePart(definition: PartDefinition, input: PartInput, context: PartContext): ResolvedPart {
  const parameters = new Map(definition.parameters.map(parameter => [parameter.key, parameter]));
  const values: Record<string, number> = {};
  const scoped: PartIssue[] = [];
  const take = (source: Readonly<Record<string, number>> | undefined, scope: 'placement' | 'state') => {
    for (const [key, value] of Object.entries(source ?? {})) {
      const parameter = parameters.get(key);
      if (parameter && parameter.scope !== scope) {
        const owner = parameter.scope === 'variant' ? 'von der Variante' : parameter.scope === 'state' ? 'vom Zustand' : 'von der Platzierung';
        scoped.push(issue('warning', 'wrong-scope', { parameter: key }, `wird ${owner} bestimmt; der übergebene Wert wird ignoriert.`));
      } else {
        values[key] = value;
      }
    }
  };
  take(input.values, 'placement');
  take(input.state, 'state');
  const resolved = resolvePartConfiguration(definition, { variant: input.variant, values }, context);
  return scoped.length ? { ...resolved, issues: [...scoped, ...resolved.issues] } : resolved;
}
