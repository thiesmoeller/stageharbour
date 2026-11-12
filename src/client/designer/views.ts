import { convexHull, quatAxes, rotate, type Vec2, type Vec3 } from '../../shared/parts/math.js';
import { solidVertices, type ResolvedConnector, type ResolvedPart, type ResolvedSolid } from '../../shared/parts/resolve.js';
import type { DesignerSelection } from './draft.js';

/**
 * The three orthographic views of the designer, in the part-local frame of the kernel
 * (+X width, +Y up, +Z away from the audience). SVG y grows downwards, so every view negates
 * the axis that points up on screen.
 *
 * - `top` (Draufsicht): seen from above, looking down −Y. Screen right is +X and the audience
 *   (−Z) sits at the bottom, as in the Grundriss of the editor (svg y = −plan y).
 * - `front` (Vorderansicht): seen from the audience, looking along +Z. Screen right is +X, up is +Y.
 * - `side` (Seitenansicht): seen from the right (+X), looking along −X. Screen right is +Z
 *   (away from the audience), up is +Y; the audience is on the left.
 */
export type PartViewId = 'top' | 'front' | 'side';

export const PART_VIEWS: readonly { id: PartViewId; label: string; caption: string }[] = [
  { id: 'top', label: 'Draufsicht', caption: 'von oben, Publikum unten' },
  { id: 'front', label: 'Vorderansicht', caption: 'aus dem Publikum' },
  { id: 'side', label: 'Seitenansicht', caption: 'von rechts, Publikum links' },
];

/** Direction the viewer looks along, in the part frame. */
export const VIEW_DIRECTION: Readonly<Record<PartViewId, Vec3>> = {
  top: { x: 0, y: -1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  side: { x: -1, y: 0, z: 0 },
};

/** A part-local point in SVG millimetres of one view. */
export function projectPoint(view: PartViewId, point: Vec3): Vec2 {
  switch (view) {
    case 'top': return { x: point.x, y: -point.z };
    case 'front': return { x: point.x, y: -point.y };
    case 'side': return { x: point.z, y: -point.y };
  }
}

/** Distance towards the viewer: larger values lie in front and are painted later. */
export function viewDepth(view: PartViewId, point: Vec3): number {
  const direction = VIEW_DIRECTION[view];
  return -(point.x * direction.x + point.y * direction.y + point.z * direction.z);
}

export type ViewShape = {
  solid: string;
  /** What a click selects: the top-level body, or the child part the solid belongs to. */
  select: DesignerSelection;
  kind: ResolvedSolid['kind'];
  material: string;
  /** SVG path data; loops after the first are holes (even-odd fill). */
  d: string;
  depth: number;
};

export type ViewConnector = {
  id: string;
  kind: string;
  /** Top-level connectors are selectable; those of child parts are drawn only. */
  select?: DesignerSelection;
  at: Vec2;
  /** End of an edge connector. */
  end?: Vec2;
  /** Unit direction on screen for a point connector; absent when it points at the viewer. */
  direction?: Vec2;
};

export type PartView = {
  id: PartViewId;
  shapes: ViewShape[];
  connectors: ViewConnector[];
  viewBox: { x: number; y: number; width: number; height: number };
  /** Extent of the solids on screen, in millimetres. */
  size: { width: number; height: number };
};

const loopPath = (points: readonly Vec2[]) =>
  points.map((point, index) => `${index ? 'L' : 'M'}${round(point.x)} ${round(point.y)}`).join(' ') + ' Z';
const round = (value: number) => Math.round(value * 100) / 100;

/** Body or child selection a solid belongs to, from its stable id path. */
export function solidSelection(solid: Pick<ResolvedSolid, 'path' | 'body'>): DesignerSelection {
  const top = solid.path[0];
  return top === undefined ? { kind: 'body', key: solid.body } : { kind: 'child', key: top.replace(/\[.*$/, '') };
}

const FACING = 1 - 1e-6;

/** Loops of a solid as seen in one view: the true outline for a sheet facing the viewer, else the hull of its corners. */
export function solidLoops(view: PartViewId, solid: ResolvedSolid): Vec2[][] {
  if (solid.kind === 'sheet') {
    const normal = quatAxes(solid.rotation).z;
    const direction = VIEW_DIRECTION[view];
    if (Math.abs(normal.x * direction.x + normal.y * direction.y + normal.z * direction.z) >= FACING) {
      const map = (point: Vec2) => {
        const local = rotate(solid.rotation, { x: point.x, y: point.y, z: 0 });
        return projectPoint(view, { x: solid.origin.x + local.x, y: solid.origin.y + local.y, z: solid.origin.z + local.z });
      };
      return [solid.outline.map(map), ...solid.holes.map(hole => hole.map(map))];
    }
  }
  return [convexHull(solidVertices(solid).map(point => projectPoint(view, point)))];
}

function solidDepth(view: PartViewId, solid: ResolvedSolid): number {
  const vertices = solidVertices(solid);
  return Math.max(...vertices.map(point => viewDepth(view, point)));
}

function connectorShape(view: PartViewId, connector: ResolvedConnector): ViewConnector {
  const at = projectPoint(view, connector.position);
  const shape: ViewConnector = {
    id: connector.id, kind: connector.kind, at,
    ...(connector.path.length ? {} : { select: { kind: 'connector', key: connector.key } satisfies DesignerSelection }),
  };
  if (connector.length > 0) {
    const tip = connector.position;
    shape.end = projectPoint(view, {
      x: tip.x + connector.axis.x * connector.length,
      y: tip.y + connector.axis.y * connector.length,
      z: tip.z + connector.axis.z * connector.length,
    });
    return shape;
  }
  const head = projectPoint(view, { x: connector.position.x + connector.axis.x, y: connector.position.y + connector.axis.y, z: connector.position.z + connector.axis.z });
  const dx = head.x - at.x, dy = head.y - at.y, span = Math.hypot(dx, dy);
  if (span > 1e-6) shape.direction = { x: dx / span, y: dy / span };
  return shape;
}

const EMPTY_HALF_EXTENT = 500;

/** One view of a resolved part: solids back to front, connectors, and a view box with a margin. */
export function buildPartView(view: PartViewId, part: Pick<ResolvedPart, 'solids' | 'connectors'>): PartView {
  const shapes = part.solids.map(solid => ({
    solid: solid.id, select: solidSelection(solid), kind: solid.kind, material: solid.material,
    loops: solidLoops(view, solid), depth: solidDepth(view, solid),
  })).sort((a, b) => a.depth - b.depth);
  const connectors = part.connectors.map(connector => connectorShape(view, connector));
  const points = [
    ...shapes.flatMap(shape => shape.loops.flat()),
    ...connectors.flatMap(connector => connector.end ? [connector.at, connector.end] : [connector.at]),
  ];
  const solidPoints = shapes.flatMap(shape => shape.loops.flat());
  const extent = (list: readonly Vec2[]) => list.length ? {
    minX: Math.min(...list.map(point => point.x)), maxX: Math.max(...list.map(point => point.x)),
    minY: Math.min(...list.map(point => point.y)), maxY: Math.max(...list.map(point => point.y)),
  } : { minX: -EMPTY_HALF_EXTENT, maxX: EMPTY_HALF_EXTENT, minY: -EMPTY_HALF_EXTENT, maxY: EMPTY_HALF_EXTENT };
  const all = extent(points);
  const solidsOnly = extent(solidPoints);
  const width = all.maxX - all.minX, height = all.maxY - all.minY;
  const margin = Math.max(60, Math.max(width, height) * 0.08);
  return {
    id: view,
    shapes: shapes.map(({ loops, ...shape }) => ({ ...shape, d: loops.filter(loop => loop.length >= 2).map(loopPath).join(' ') })),
    connectors,
    viewBox: { x: all.minX - margin, y: all.minY - margin, width: width + 2 * margin, height: height + 2 * margin },
    size: solidPoints.length
      ? { width: solidsOnly.maxX - solidsOnly.minX, height: solidsOnly.maxY - solidsOnly.minY }
      : { width: 0, height: 0 },
  };
}

export function sameSelection(a: DesignerSelection | undefined, b: DesignerSelection | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return 'key' in a && 'key' in b ? a.key === b.key : 'index' in a && 'index' in b ? a.index === b.index : false;
}
