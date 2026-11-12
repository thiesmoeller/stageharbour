import { BufferGeometry, ExtrudeGeometry } from 'three';
import { braceMembers, braceSolid } from '../../src/shared/braceTransforms.js';
import {
  orientedPlatformBox, platformCentroid, stairSteps, surfaceElevationUnderPoint,
  type Platform, type StairUnit, type SupportingSurface,
} from '../../src/shared/levels.js';
import { placeholderSolid, type Placeholder } from '../../src/shared/placeholders.js';
import {
  STAGE_DECK_FRAME_PROFILE_MM, STAGE_DECK_LEG_SECTION_MM, STAGE_DECK_RUBBER_HEIGHT_MM,
  STAGE_DECK_RUBBER_SECTION_MM, STAGE_DECK_TOP_THICKNESS_MM, layoutStageDeckModules, stageDeckLegPositions,
} from '../../src/shared/stageDeck.js';
import { wallSolid } from '../../src/shared/transforms.js';
import { DOOR_FRAME, DOOR_LEAF, doorOpenAngleDegrees, isDoorOpening, openingOutlinePoints, type Opening } from '../../src/shared/wall-types.js';
import { buildWallPanelGeometry } from '../../src/shared/wallMeshGeometry.js';
import { faceSplitMm, type WallSurfaces } from '../../src/shared/surfaces.js';
import type { Brace, Wall } from '../../src/shared/layout.js';
import { boxCorners, worldBox, worldPoint, type Pose } from './pose.js';
import type { NeutralBox, NeutralElementSolids, NeutralPrism, NeutralSphere, Point } from './types.js';

/**
 * Mirrors the client-only geometry (WallMesh DoorFittings, StageLevels, StageBraces, StagePlaceholders) as
 * model-neutral boxes. Everything is derived from the same shared functions and constants the editor uses.
 */

const FIT_GAP_MM = 1;

type Tuple3 = readonly [number, number, number];

function sizeOf(box: { x: number; y: number; z: number }): Tuple3 {
  return [box.x, box.y, box.z];
}

export type WallDetails = {
  doorOpenPercent: number;
  openings: { id: string; hinge?: string; profile?: string; outline: Point[] }[];
  mesh: WallMeshSummary;
};

export type WallMeshSummary = {
  vertexCount: number;
  triangleCount: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  groups: { materialIndex: number; triangles: number; areaMm2: number }[];
};

function triangleArea(positions: BufferGeometry['attributes'][string], a: number, b: number, c: number) {
  const ax = positions.getX(a), ay = positions.getY(a), az = positions.getZ(a);
  const ux = positions.getX(b) - ax, uy = positions.getY(b) - ay, uz = positions.getZ(b) - az;
  const vx = positions.getX(c) - ax, vy = positions.getY(c) - ay, vz = positions.getZ(c) - az;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

export function wallMeshSummary(
  size: { x: number; y: number; z: number }, openings: readonly Opening[], surfaces: WallSurfaces | undefined,
): WallMeshSummary {
  const geometry: ExtrudeGeometry = buildWallPanelGeometry(size, openings, {
    frontMm: faceSplitMm(surfaces?.front, size.y), backMm: faceSplitMm(surfaces?.back, size.y),
  });
  try {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const read = (i: number) => (index ? index.getX(i) : i);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const groups = geometry.groups.map(group => {
      let area = 0;
      for (let at = group.start; at < group.start + group.count; at += 3) {
        area += triangleArea(position, read(at), read(at + 1), read(at + 2));
      }
      return { materialIndex: group.materialIndex ?? 0, triangles: group.count / 3, areaMm2: Math.round(area) };
    });
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      vertexCount: position.count,
      triangleCount: (index ? index.count : position.count) / 3,
      bbox: {
        min: [round(box.min.x), round(box.min.y), round(box.min.z)],
        max: [round(box.max.x), round(box.max.y), round(box.max.z)],
      },
      groups,
    };
  } finally {
    geometry.dispose();
  }
}

export type SolidsResult = NeutralElementSolids & { details?: WallDetails };

export function wallSolids(
  wall: Wall & { openings: Opening[] }, elevation: number, doorOpenPercent: number, surfaces: WallSurfaces | undefined,
): SolidsResult {
  const solid = wallSolid({ ...wall, doorOpenPercent }, elevation);
  const root: Pose = { position: [solid.center.x, solid.center.y, solid.center.z], rotation: [0, solid.rotationY, 0] };
  const boxes: NeutralBox[] = [worldBox('panel', [root], sizeOf(solid.size))];
  const hw = solid.size.x / 2, hh = solid.size.y / 2;
  const front = -solid.size.z / 2;
  const angle = doorOpenAngleDegrees(doorOpenPercent) * Math.PI / 180;
  for (const opening of solid.openings.filter(isDoorOpening)) {
    const x0 = -hw + opening.left, y0 = -hh + opening.sill;
    const x1 = x0 + opening.width, y1 = y0 + opening.height;
    const { face, depth } = DOOR_FRAME;
    const frameZ = front - depth / 2;
    const frame = (name: string, position: Tuple3, size: Tuple3) =>
      boxes.push(worldBox(`door.frame.${name}.${opening.id}`, [root, { position }], size));
    frame('bottom', [(x0 + x1) / 2, y0 - face / 2, frameZ], [opening.width + face * 2, face, depth]);
    frame('top', [(x0 + x1) / 2, y1 + face / 2, frameZ], [opening.width + face * 2, face, depth]);
    frame('left', [x0 - face / 2, (y0 + y1) / 2, frameZ], [face, opening.height, depth]);
    frame('right', [x1 + face / 2, (y0 + y1) / 2, frameZ], [face, opening.height, depth]);
    const hingeX = opening.hinge === 'left' ? x0 : x1;
    const leafSign = opening.hinge === 'left' ? 1 : -1;
    const yaw = opening.hinge === 'left' ? angle : -angle;
    boxes.push(worldBox(`door.leaf.${opening.id}`, [
      root,
      { position: [hingeX, (y0 + y1) / 2, front - DOOR_LEAF.thickness / 2], rotation: [0, yaw, 0] },
      { position: [leafSign * DOOR_LEAF.width / 2, 0, 0] },
    ], [DOOR_LEAF.width, DOOR_LEAF.height, DOOR_LEAF.thickness]));
  }
  return {
    boxes,
    details: {
      doorOpenPercent,
      openings: solid.openings.map(opening => ({
        id: opening.id, hinge: opening.hinge, profile: opening.profile, outline: openingOutlinePoints(opening),
      })),
      mesh: wallMeshSummary(solid.size, solid.openings, surfaces),
    },
  };
}

export function braceSolids(brace: Brace, elevation: number): NeutralElementSolids {
  const solid = braceSolid(brace, elevation);
  const root: Pose = {
    position: [solid.center.x, solid.footprint[0]?.y ?? 0, solid.center.z], rotation: [0, solid.rotationY, 0],
  };
  const boxes: NeutralBox[] = [];
  solid.ballast.forEach((part, index) => boxes.push(worldBox(`ballast.${part.kind}.${index}`, [
    root, { position: [part.center.x, part.center.y, part.center.z], rotation: [part.rotation.x, part.rotation.y, part.rotation.z] },
  ], sizeOf(part.size))));
  for (const member of braceMembers(brace)) {
    boxes.push(worldBox(`member.${member.kind}`, [
      root, { position: [member.center.x, member.center.y, member.center.z], rotation: [member.rotation.x, member.rotation.y, member.rotation.z] },
    ], sizeOf(member.size)));
  }
  return { boxes };
}

function outlinePlanRotation(outline: Platform['outline']) {
  const a = outline[0], b = outline[1];
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function isRectangularOutline(outline: Platform['outline']) {
  if (outline.length !== 4) return false;
  return outline.every((point, index) => {
    const previous = outline[(index + 3) % 4]!;
    const next = outline[(index + 1) % 4]!;
    const ax = previous.x - point.x, ay = previous.y - point.y;
    const bx = next.x - point.x, by = next.y - point.y;
    const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
    return scale > 0 && Math.abs(ax * bx + ay * by) <= scale * 1e-6;
  });
}

export function platformSolids(platform: Platform, peers: readonly Platform[]): NeutralElementSolids {
  const centre = platformCentroid(platform.outline);
  const rotation = outlinePlanRotation(platform.outline);
  const style = platform.style ?? 'floating';
  const box = orientedPlatformBox(platform.outline);
  const root: Pose = { position: [centre.x, 0, centre.y], rotation: [0, -rotation, 0] };
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const worldXY = (localX: number, localY: number) => ({
    x: centre.x + localX * cos - localY * sin, y: centre.y + localX * sin + localY * cos,
  });
  const solidBase = style === 'solid' ? surfaceElevationUnderPoint(centre, peers, platform.elevation, platform.id) : 0;
  const rise = Math.max(1, platform.elevation - solidBase);
  const deckThickness = style === 'solid' ? rise : style === 'stageDeck' ? STAGE_DECK_TOP_THICKNESS_MM : 40;
  const boxes: NeutralBox[] = [];
  const prisms: NeutralPrism[] = [];
  const rectangular = isRectangularOutline(platform.outline);

  if (style !== 'stageDeck') {
    if (rectangular) {
      boxes.push(worldBox('slab', [root, { position: [0, platform.elevation - deckThickness / 2, 0] }], [box.width, deckThickness, box.depth]));
    } else {
      prisms.push({
        part: 'slab', outline: platform.outline.map(point => ({ x: point.x, y: point.y })),
        bottom: platform.elevation - deckThickness, top: platform.elevation,
      });
    }
  }

  if (style === 'stageDeck') {
    const t = STAGE_DECK_TOP_THICKNESS_MM, f = STAGE_DECK_FRAME_PROFILE_MM;
    const y = platform.elevation - t / 2;
    layoutStageDeckModules(box.width, box.depth, platform.deckGrain).forEach((module, index) => {
      const { x, y: z, width, depth } = module;
      const innerW = Math.max(1, width - 2 * f - FIT_GAP_MM), innerD = Math.max(1, depth - 2 * f - FIT_GAP_MM);
      const edge = (name: string, position: Tuple3, size: Tuple3) =>
        boxes.push(worldBox(`deck.module.${index}.${name}`, [root, { position }], size));
      edge('edge.north', [x, y, z + (depth - f) / 2], [width, t, f]);
      edge('edge.south', [x, y, z - (depth - f) / 2], [width, t, f]);
      edge('edge.east', [x + (width - f) / 2, y, z], [f, t, Math.max(1, depth - 2 * f)]);
      edge('edge.west', [x - (width - f) / 2, y, z], [f, t, Math.max(1, depth - 2 * f)]);
      edge('infield', [x, y, z], [innerW, t, innerD]);
    });
    stageDeckLegPositions(box.width, box.depth, platform.deckGrain).forEach((leg, index) => {
      const baseElevation = surfaceElevationUnderPoint(worldXY(leg.x, leg.y), peers, platform.elevation, platform.id);
      const postTop = Math.max(baseElevation + STAGE_DECK_RUBBER_HEIGHT_MM + 1, platform.elevation - STAGE_DECK_TOP_THICKNESS_MM);
      const postHeight = Math.max(1, postTop - baseElevation - STAGE_DECK_RUBBER_HEIGHT_MM);
      const legPose: Pose = { position: [leg.x, baseElevation, leg.y] };
      boxes.push(worldBox(`deck.leg.${index}.rubber`, [root, legPose, { position: [0, STAGE_DECK_RUBBER_HEIGHT_MM / 2, 0] }],
        [STAGE_DECK_RUBBER_SECTION_MM, STAGE_DECK_RUBBER_HEIGHT_MM, STAGE_DECK_RUBBER_SECTION_MM]));
      boxes.push(worldBox(`deck.leg.${index}.post`, [root, legPose, { position: [0, STAGE_DECK_RUBBER_HEIGHT_MM + postHeight / 2, 0] }],
        [STAGE_DECK_LEG_SECTION_MM, postHeight, STAGE_DECK_LEG_SECTION_MM]));
    });
  }
  return { boxes, ...(prisms.length ? { prisms } : {}) };
}

export function stairSolids(stair: StairUnit, surfaces: SupportingSurface[]): NeutralElementSolids {
  return {
    boxes: stairSteps(stair, surfaces).map((step, index) => worldBox(`step.${index}`, [
      { position: [step.x, step.y, step.z], rotation: [0, step.rotationY, 0] },
    ], [step.width, step.height, step.depth])),
  };
}

export function placeholderSolids(item: Placeholder, elevation: number): NeutralElementSolids {
  const solid = placeholderSolid(item, elevation);
  const w = solid.size.x, h = solid.size.y, d = solid.size.z;
  if (solid.kind !== 'chair') {
    return {
      boxes: [worldBox('body', [
        { position: [solid.center.x, solid.center.y, solid.center.z], rotation: [0, solid.rotationY, 0] },
      ], [w, h, d])],
    };
  }
  const seatH = h * 0.48, seatT = Math.max(20, h * 0.06), backT = Math.max(20, d * 0.08), leg = Math.max(18, Math.min(w, d) * 0.08);
  const root: Pose = { position: [solid.center.x, solid.center.y - h / 2, solid.center.z], rotation: [0, solid.rotationY, 0] };
  const boxes: NeutralBox[] = [
    worldBox('chair.seat', [root, { position: [0, seatH, 0] }], [w * 0.92, seatT, d * 0.75]),
    worldBox('chair.back', [root, { position: [0, seatH + (h - seatH) / 2, -d * 0.32] }], [w * 0.92, h - seatH, backT]),
  ];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    boxes.push(worldBox(`chair.leg.${sx}.${sz}`, [root, { position: [sx * (w * 0.38), seatH / 2, sz * (d * 0.28)] }], [leg, seatH, leg]));
  }
  const spheres: NeutralSphere[] = [];
  if (solid.seatedFigure) {
    const figure: Pose = { position: [0, seatH + seatT / 2, d * 0.02] };
    boxes.push(worldBox('figure.torso', [root, figure, { position: [0, h * 0.18, 0] }], [w * 0.35, h * 0.28, d * 0.28]));
    boxes.push(worldBox('figure.thighs', [root, figure, { position: [0, h * 0.06, d * 0.12], rotation: [0.4, 0, 0] }], [w * 0.32, h * 0.12, d * 0.35]));
    const head = worldPoint([root, figure], [0, h * 0.38, 0]);
    spheres.push({ part: 'figure.head', center: head, radius: Math.min(w, d) * 0.12 });
  }
  return { boxes, ...(spheres.length ? { spheres } : {}) };
}

export function solidBounds(solids: NeutralElementSolids) {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const grow = (x: number, y: number, z: number) => {
    min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
  };
  for (const box of solids.boxes) for (const corner of boxCorners(box)) grow(corner.x, corner.y, corner.z);
  for (const sphere of solids.spheres ?? []) {
    grow(sphere.center.x - sphere.radius, sphere.center.y - sphere.radius, sphere.center.z - sphere.radius);
    grow(sphere.center.x + sphere.radius, sphere.center.y + sphere.radius, sphere.center.z + sphere.radius);
  }
  for (const prism of solids.prisms ?? []) {
    for (const point of prism.outline) { grow(point.x, prism.bottom, point.y); grow(point.x, prism.top, point.y); }
  }
  return { min, max };
}
