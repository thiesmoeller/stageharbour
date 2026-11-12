import { readFileSync } from 'node:fs';
import { Euler, Quaternion, Vector3 } from 'three';
import { venueGeometrySchema, type VenueGeometry } from '../../src/shared/layout.js';
import { layoutV1Schema, layoutV1ToV2, type LayoutV1 } from '../../src/shared/layoutMigrate.js';
import { createLayoutPartIndex, resolveLayoutObjects } from '../../src/shared/layoutObjects.js';
import { supportingSurfaces } from '../../src/shared/levels.js';
import { STARTER_LIBRARY } from '../../src/shared/parts/starter/index.js';
import type { ResolvedSolid } from '../../src/shared/parts/resolve.js';
import type { NeutralBox, NeutralFootprints, NeutralSolids, NeutralSurfaces } from './types.js';

const FIXTURES = ['demo-seed', 'kitchen-sink', 'warnings', 'wall-types', 'stage-decks'] as const;
const index = createLayoutPartIndex(STARTER_LIBRARY);
const RAD_TO_DEG = 180 / Math.PI;

export type V2GoldenFixture = {
  name: typeof FIXTURES[number];
  legacy: LayoutV1;
  venue: VenueGeometry;
  objectIds: string[];
  footprints: NeutralFootprints;
  solids: NeutralSolids;
  surfaces: NeutralSurfaces;
};

function inputOf(name: string) {
  const url = new URL(`./${name}/input.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as { layout: unknown; venue: unknown };
}

function eulerOf(rotation: { x: number; y: number; z: number; w: number }) {
  const euler = new Euler().setFromQuaternion(
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    'XYZ',
  );
  const degrees = (value: number) => {
    const result = value * RAD_TO_DEG;
    return Math.abs(result) < 1e-9 ? 0 : result;
  };
  return { x: degrees(euler.x), y: degrees(euler.y), z: degrees(euler.z) };
}

function solidBox(solid: ResolvedSolid): NeutralBox {
  if (solid.kind !== 'sheet') {
    return {
      part: solid.id,
      center: solid.center,
      size: solid.size,
      rotation: eulerOf(solid.rotation),
    };
  }
  const xs = solid.outline.map(point => point.x), ys = solid.outline.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const quaternion = new Quaternion(solid.rotation.x, solid.rotation.y, solid.rotation.z, solid.rotation.w);
  const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, solid.thickness / 2)
    .applyQuaternion(quaternion)
    .add(new Vector3(solid.origin.x, solid.origin.y, solid.origin.z));
  return {
    part: solid.id,
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: maxX - minX, y: maxY - minY, z: solid.thickness },
    rotation: eulerOf(solid.rotation),
  };
}

export function loadV2GoldenFixtures(): V2GoldenFixture[] {
  return FIXTURES.map(name => {
    const input = inputOf(name);
    const legacy = layoutV1Schema.parse(input.layout);
    const venue = venueGeometrySchema.parse(input.venue);
    const layout = layoutV1ToV2(legacy, { part: index.part });
    const venueSurfaces = supportingSurfaces(venue);
    const supportElevations = new Map(venueSurfaces.map(surface => [surface.id, surface.elevation]));
    const objects = resolveLayoutObjects(layout, index, { supportElevations });
    const objectSurfaces = objects.flatMap(object => object.surfaces.slice(0, 1).map(surface => ({
      id: object.object.id,
      outline: surface.outline,
      elevation: surface.elevation,
    })));
    return {
      name,
      legacy,
      venue,
      objectIds: objects.map(object => object.object.id),
      footprints: Object.fromEntries(objects.map(object => [
        object.object.id,
        { kind: 'object', polygon: object.footprint },
      ])),
      solids: Object.fromEntries(objects.map(object => [
        object.object.id,
        { boxes: object.solids.map(solidBox) },
      ])),
      surfaces: {
        surfaces: [...venueSurfaces.map(surface => ({
          id: surface.id,
          outline: surface.outline,
          elevation: surface.elevation,
        })), ...objectSurfaces],
        elevations: Object.fromEntries(objects.map(object => [
          object.object.id,
          object.surfaces.length
            ? Math.max(...object.surfaces.map(surface => surface.elevation))
            : object.elevation,
        ])),
      },
    };
  });
}
