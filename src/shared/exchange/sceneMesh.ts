import {
  BoxGeometry, BufferAttribute, BufferGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Layout, VenueGeometry } from '../layout.js';
import {
  resolveLayoutObjectDetails,
  type LayoutObjectResolutionIssue, type LayoutPartIndex, type ResolvedLayoutObject,
} from '../layoutObjects.js';
import {
  AUDIENCE_FLOOR_ID, platformCentroid, stairSteps, supportingSurfaces, surfaceElevation, surfaceElevationUnderPoint,
  type Platform,
} from '../levels.js';
import { buildPartGeometry } from '../parts/geometry.js';
import { partRefKey, type PartRef } from '../parts/index.js';
import { STAGE_DECK_TOP_THICKNESS_MM } from '../stageDeck.js';
import { placeholderSolid } from '../placeholders.js';
import { ralHex } from '../ral.js';
import type { FaceSurfacing, SurfaceFinish } from '../surfaces.js';
import { resolveWall } from '../wall-types.js';
import { buildWallPanelGeometry } from '../wallMeshGeometry.js';
import { measuredOutline } from '../venue.js';

/**
 * Exchange frame, shared by the glTF and the MVR export.
 *
 * Every entry is a mesh in its own local frame plus a placement in the plan. The mesh is in
 * metres, right-handed, +Y up, as glTF 2.0 requires, with the plan's x along +X and the plan's
 * y (away from the audience) along -Z. A viewer that opens the glb therefore looks at the
 * stage from the audience side, +X to the right. A Z-up consumer (MVR, millimetres) turns the
 * same data into plan x = X, plan y = Y, up = Z.
 *
 * `placement` is the entry's origin in the plan: millimetres, rotation in degrees
 * counter-clockwise in the plan, `elevation` above the audience floor.
 */
export const EXCHANGE_METRES_PER_MM = 0.001;

export type SceneEntryKind = 'floor' | 'wall' | 'platform' | 'stair' | 'placeholder' | 'truss' | 'part';
export type SceneLayer = 'venue' | 'scene';

export type SceneMaterial = {
  key: string;
  name: string;
  /** `#rrggbb`, sRGB. */
  color: string;
  roughness: number;
  metalness: number;
};

export type SceneGeometry = {
  key: string;
  /** Metres, glTF frame. One triangle group per entry of `materials` when there is more than one. */
  geometry: BufferGeometry;
  /** Material key per triangle group in order; a single entry covers the whole geometry. */
  materials: string[];
};

export type SceneEntryPlacement = { x: number; y: number; elevation: number; rotation: number };

export type SceneMeshEntry = {
  /** UUID: the layout object or venue element id, so a re-export keeps identities. */
  id: string;
  name: string;
  kind: SceneEntryKind;
  layer: SceneLayer;
  geometryKey: string;
  placement: SceneEntryPlacement;
  part?: PartRef;
};

export type SceneMeshSkip = { id: string; name: string; reason: string };

export type SceneMesh = {
  entries: SceneMeshEntry[];
  geometries: Map<string, SceneGeometry>;
  materials: Map<string, SceneMaterial>;
  /** Layout objects that are not in the export, with the reason in German. */
  skipped: SceneMeshSkip[];
  issues: LayoutObjectResolutionIssue[];
};

export type SceneMeshInput = {
  layout: Layout;
  venue: VenueGeometry;
  /** Part catalog the layout resolves against. */
  catalog: LayoutPartIndex;
};

const FLOOR_THICKNESS_MM = 50;
const FLOATING_PLATFORM_THICKNESS_MM = 40;
const TRUSS_CHORD_MM = 50;
const FALLBACK_COLOR = '#b4b4b4';

const VENUE_MATERIALS = {
  floor: { key: 'venue:floor', name: 'Zuschauerboden', color: '#6b6f76', roughness: 0.9, metalness: 0 },
  wall: { key: 'venue:wall', name: 'Wand der Spielstätte', color: '#d4cfc4', roughness: 0.9, metalness: 0 },
  platform: { key: 'venue:platform', name: 'Podest', color: '#b7c2aa', roughness: 0.85, metalness: 0 },
  stair: { key: 'venue:stair', name: 'Treppe', color: '#c6cfbd', roughness: 0.85, metalness: 0 },
  truss: { key: 'venue:truss', name: 'Traverse', color: '#2c2d30', roughness: 0.45, metalness: 0.7 },
  placeholder: { key: 'venue:placeholder', name: 'Platzhalter', color: '#b08968', roughness: 0.85, metalness: 0 },
} satisfies Record<string, SceneMaterial>;

function paintHex(finish: SurfaceFinish | FaceSurfacing | undefined): string | undefined {
  if (!finish) return undefined;
  if ('kind' in finish) return finish.kind === 'paint' ? ralHex(finish.ral) : undefined;
  return paintHex(finish.full) ?? paintHex(finish.lower) ?? paintHex(finish.upper);
}

/** Raw geometry is millimetres in the viewer's mirrored frame (+X audience-right, +Z upstage). */
function toExchangeFrame(raw: BufferGeometry): BufferGeometry {
  const geometry = raw.clone();
  geometry.deleteAttribute('uv');
  geometry.scale(EXCHANGE_METRES_PER_MM, EXCHANGE_METRES_PER_MM, -EXCHANGE_METRES_PER_MM);
  const source = geometry.getIndex();
  const count = source ? source.count : geometry.getAttribute('position').count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = source ? source.getX(i) : i;
  // The Z flip mirrors the mesh; swapping two corners of each triangle restores outward-facing winding.
  for (let i = 0; i + 2 < count; i += 3) {
    const swap = index[i + 1]!;
    index[i + 1] = index[i + 2]!;
    index[i + 2] = swap;
  }
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  return geometry;
}

function slab(outline: readonly { x: number; y: number }[], thickness: number, centre: { x: number; y: number }): BufferGeometry {
  const shape = new Shape();
  outline.forEach((point, index) => {
    const x = point.x - centre.x, y = point.y - centre.y;
    if (index) shape.lineTo(x, y); else shape.moveTo(x, y);
  });
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
  geometry.rotateX(Math.PI / 2);
  geometry.clearGroups();
  return geometry;
}

function box(size: [number, number, number], at: [number, number, number]): BufferGeometry {
  return new BoxGeometry(...size).translate(...at);
}

function merged(geometries: BufferGeometry[]): BufferGeometry {
  const result = mergeGeometries(geometries.map(geometry => {
    geometry.clearGroups();
    return geometry;
  }));
  if (!result) throw new Error('Geometrien konnten nicht zusammengeführt werden.');
  return result;
}

function sorted(values: Readonly<Record<string, number>>): string {
  return JSON.stringify(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** One ordered list of meshes with placements for the venue shell and the placed parts. */
export function buildSceneMesh(input: SceneMeshInput): SceneMesh {
  const { layout, venue, catalog } = input;
  const surfaces = supportingSurfaces(venue);
  const mesh: SceneMesh = { entries: [], geometries: new Map(), materials: new Map(), skipped: [], issues: [] };
  const material = (value: SceneMaterial) => {
    if (!mesh.materials.has(value.key)) mesh.materials.set(value.key, value);
    return value.key;
  };
  const geometryOf = (key: string, build: () => { geometry: BufferGeometry; materials: string[] }) => {
    if (!mesh.geometries.has(key)) {
      const built = build();
      mesh.geometries.set(key, { key, geometry: toExchangeFrame(built.geometry), materials: built.materials });
    }
    return key;
  };

  const outline = measuredOutline(venue);
  const floorCentre = platformCentroid(outline);
  mesh.entries.push({
    id: AUDIENCE_FLOOR_ID, name: 'Zuschauerboden', kind: 'floor', layer: 'venue',
    geometryKey: geometryOf(`floor|${JSON.stringify(outline)}`, () => ({
      geometry: slab(outline, FLOOR_THICKNESS_MM, floorCentre), materials: [material(VENUE_MATERIALS.floor)],
    })),
    placement: { x: floorCentre.x, y: floorCentre.y, elevation: 0, rotation: 0 },
  });

  for (const wall of venue.walls ?? []) {
    const resolved = resolveWall(wall, venue.wallTypes ?? []);
    const size = { x: resolved.width, y: resolved.height, z: resolved.thickness };
    mesh.entries.push({
      id: wall.id, name: wall.label, kind: 'wall', layer: 'venue',
      geometryKey: geometryOf(`wall|${size.x}|${size.y}|${size.z}|${JSON.stringify(resolved.openings)}`, () => ({
        geometry: buildWallPanelGeometry(size, resolved.openings), materials: [material(VENUE_MATERIALS.wall)],
      })),
      placement: {
        x: wall.x, y: wall.y, elevation: surfaceElevation(surfaces, wall.supportingSurfaceId) + resolved.height / 2,
        rotation: wall.rotation,
      },
    });
  }

  const platforms: Platform[] = venue.platforms ?? [];
  for (const platform of platforms) {
    const style = platform.style ?? 'floating';
    const centre = platformCentroid(platform.outline);
    const base = style === 'solid' ? surfaceElevationUnderPoint(centre, platforms, platform.elevation, platform.id) : 0;
    const thickness = style === 'solid' ? Math.max(1, platform.elevation - base)
      : style === 'stageDeck' ? STAGE_DECK_TOP_THICKNESS_MM : FLOATING_PLATFORM_THICKNESS_MM;
    mesh.entries.push({
      id: platform.id, name: platform.label, kind: 'platform', layer: 'venue',
      geometryKey: geometryOf(`platform|${thickness}|${JSON.stringify(platform.outline.map(point => [point.x - centre.x, point.y - centre.y]))}`, () => ({
        geometry: slab(platform.outline, thickness, centre), materials: [material(VENUE_MATERIALS.platform)],
      })),
      placement: { x: centre.x, y: centre.y, elevation: platform.elevation, rotation: 0 },
    });
  }

  for (const stair of venue.stairs ?? []) {
    const steps = stairSteps(stair, surfaces);
    const base = surfaceElevation(surfaces, stair.lowerSurfaceId);
    const first = steps[0];
    if (!first) continue;
    mesh.entries.push({
      id: stair.id, name: stair.label, kind: 'stair', layer: 'venue',
      geometryKey: geometryOf(`stair|${stair.width}|${stair.run}|${steps.length}|${first.height}`, () => ({
        geometry: merged(steps.map((step, index) => box(
          [step.width, step.height * (index + 1), step.depth],
          [0, step.height * (index + 1) / 2, -stair.run / 2 + (index + 0.5) * step.depth],
        ))),
        materials: [material(VENUE_MATERIALS.stair)],
      })),
      placement: { x: stair.x, y: stair.y, elevation: base, rotation: stair.rotation },
    });
  }

  for (const item of venue.placeholders ?? []) {
    const solid = placeholderSolid(item, surfaceElevation(surfaces, item.supportingSurfaceId));
    mesh.entries.push({
      id: item.id, name: item.label, kind: 'placeholder', layer: 'venue',
      geometryKey: geometryOf(`placeholder|${solid.size.x}|${solid.size.y}|${solid.size.z}`, () => ({
        geometry: box([solid.size.x, solid.size.y, solid.size.z], [0, 0, 0]), materials: [material(VENUE_MATERIALS.placeholder)],
      })),
      placement: { x: item.x, y: item.y, elevation: solid.center.y, rotation: item.rotation },
    });
  }

  for (const truss of venue.trusses ?? []) {
    const dx = truss.sectionWidth / 2 - TRUSS_CHORD_MM / 2, dy = truss.thickness / 2 - TRUSS_CHORD_MM / 2;
    mesh.entries.push({
      id: truss.id, name: truss.label, kind: 'truss', layer: 'venue',
      geometryKey: geometryOf(`truss|${truss.length}|${truss.sectionWidth}|${truss.thickness}`, () => ({
        geometry: merged([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
          box([truss.length, TRUSS_CHORD_MM, TRUSS_CHORD_MM], [0, sy! * dy, sx! * dx]))),
        materials: [material(VENUE_MATERIALS.truss)],
      })),
      placement: { x: truss.x, y: truss.y, elevation: truss.bottomHeight + truss.thickness / 2, rotation: truss.rotation ?? 0 },
    });
  }

  const resolution = resolveLayoutObjectDetails(layout, catalog, {
    supportElevations: new Map(surfaces.map(surface => [surface.id, surface.elevation])),
  });
  mesh.issues = resolution.issues;
  const resolved = new Set(resolution.objects.map(item => item.object.id));
  for (const object of layout.objects) {
    if (!resolved.has(object.id)) {
      mesh.skipped.push({ id: object.id, name: object.label, reason: 'Bauteil nicht im Katalog gefunden.' });
    }
  }
  for (const item of resolution.objects) {
    const entry = partEntry(item, catalog, geometryOf, material);
    if (entry) mesh.entries.push(entry);
    else mesh.skipped.push({ id: item.object.id, name: item.object.label, reason: 'Das Bauteil hat keine Körper.' });
  }
  return mesh;
}

function partEntry(
  item: ResolvedLayoutObject,
  catalog: LayoutPartIndex,
  geometryOf: (key: string, build: () => { geometry: BufferGeometry; materials: string[] }) => string,
  material: (value: SceneMaterial) => string,
): SceneMeshEntry | undefined {
  const { resolved, object } = item;
  if (!resolved.solids.length) return undefined;
  const finishColours = new Map<string, string>();
  for (const [face, finish] of Object.entries(object.finishes ?? {})) {
    const hex = paintHex(finish);
    if (hex) finishColours.set(face, hex);
  }
  const used = resolved.faces.filter(face => finishColours.has(face.key)).map(face => `${face.key}=${finishColours.get(face.key)}`).sort();
  const key = `part|${partRefKey(resolved.part)}|${resolved.variant ?? ''}|${sorted(resolved.values)}|${used.join(',')}`;
  const geometryKey = geometryOf(key, () => {
    const built = buildPartGeometry({ solids: resolved.solids, faces: resolved.faces });
    const materials = built.slots.map(slot => {
      const painted = slot.face !== undefined ? finishColours.get(slot.face) : undefined;
      if (painted) {
        return material({ key: `paint:${painted}`, name: `Anstrich ${painted}`, color: painted, roughness: 0.72, metalness: 0.02 });
      }
      const stock = catalog.context.material(slot.material);
      return material({
        key: `part:${slot.material}`, name: stock?.name ?? slot.material, color: stock?.color ?? FALLBACK_COLOR,
        roughness: 0.82, metalness: 0,
      });
    });
    return { geometry: built.geometry, materials };
  });
  return {
    id: object.id, name: object.label, kind: 'part', layer: 'scene', geometryKey,
    placement: { x: object.x, y: object.y, elevation: item.elevation, rotation: object.rotation },
    part: object.part,
  };
}

function threeMaterial(value: SceneMaterial): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: value.color, roughness: value.roughness, metalness: value.metalness });
  material.name = value.name;
  return material;
}

function meshFor(geometry: SceneGeometry, materials: ReadonlyMap<string, Material>): Mesh {
  const used = geometry.materials.map(key => materials.get(key)!);
  return new Mesh(geometry.geometry, used.length === 1 ? used[0]! : used);
}

function materialInstances(scene: SceneMesh, keys?: readonly string[]): Map<string, Material> {
  return new Map([...scene.materials]
    .filter(([key]) => !keys || keys.includes(key))
    .map(([key, value]) => [key, threeMaterial(value)]));
}

/** Node transform of an entry in the exchange frame: metres, +Y up. */
export function applyEntryPlacement(object: { position: { set(x: number, y: number, z: number): unknown }; rotation: { y: number } }, placement: SceneEntryPlacement) {
  object.position.set(
    placement.x * EXCHANGE_METRES_PER_MM,
    placement.elevation * EXCHANGE_METRES_PER_MM,
    -placement.y * EXCHANGE_METRES_PER_MM,
  );
  object.rotation.y = placement.rotation * Math.PI / 180;
}

function entryExtras(entry: SceneMeshEntry) {
  return {
    stageharbour: {
      id: entry.id, kind: entry.kind, layer: entry.layer,
      ...(entry.part ? { part: entry.part } : {}),
      placementMm: entry.placement,
    },
  };
}

/** The whole scene as three.js objects: one node per entry, identical geometry shared. */
export function sceneMeshToObject3D(scene: SceneMesh, name = 'StageHarbour'): Group {
  const root = new Group();
  root.name = name;
  const materials = materialInstances(scene);
  for (const entry of scene.entries) {
    const mesh = meshFor(scene.geometries.get(entry.geometryKey)!, materials);
    mesh.name = entry.name;
    applyEntryPlacement(mesh, entry.placement);
    mesh.userData = entryExtras(entry);
    root.add(mesh);
  }
  return root;
}

/** One geometry at the origin, for the file an MVR scene object points to. */
export function sceneGeometryToObject3D(scene: SceneMesh, geometryKey: string, name: string): Group {
  const root = new Group();
  root.name = name;
  const geometry = scene.geometries.get(geometryKey)!;
  const mesh = meshFor(geometry, materialInstances(scene, geometry.materials));
  mesh.name = name;
  root.add(mesh);
  return root;
}
