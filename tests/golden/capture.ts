import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ballastLabel, materialRequirements, sceneMaterials, type BallastStock } from '../../src/shared/ballast.js';
import { braceBallast, braceCorners, braceMembers, braceSlabFootprints } from '../../src/shared/braceTransforms.js';
import { assemblyCaption, assignAssemblyNumbers } from '../../src/shared/assembly.js';
import { curtainCorners } from '../../src/shared/curtains.js';
import { resolveDimension } from '../../src/shared/dimensions.js';
import { elevationFaces } from '../../src/shared/elevations.js';
import { composeDocument, cableScheduleRows, contentBounds, type FrozenScene } from '../../src/shared/exportDocument.js';
import { constructionSnapshotSchema, freezeSnapshot, germanDate, type ConstructionSnapshot } from '../../src/shared/export.js';
import { groupPivot } from '../../src/shared/groups.js';
import { requiredCableLengthMm } from '../../src/shared/infrastructure.js';
import {
  inventoryPanelSchema, inventoryWarnings, placementType, usablePanels, type InventoryPanel,
} from '../../src/shared/inventory.js';
import { keepClearWarnings } from '../../src/shared/keepClear.js';
import { layoutSchema, venueGeometrySchema, type Layout, type Scene, type VenueGeometry } from '../../src/shared/layout.js';
import {
  AUDIENCE_FLOOR_ID, layoutDiagnostics, orientedPlatformBox, reassignLayoutSupports, resolveSupportingSurfaceId,
  stairCorners, stairRise, supportingSurfaces, surfaceElevation, type Platform, type StairUnit,
} from '../../src/shared/levels.js';
import { objectOverlapWarnings } from '../../src/shared/overlap.js';
import { overheadBoxCorners, overheadClearance } from '../../src/shared/overhead.js';
import { freezePackage } from '../../src/shared/package.js';
import { placeholderCorners, type Placeholder } from '../../src/shared/placeholders.js';
import { planReportExtent } from '../../src/shared/planReportExtent.js';
import { layoutStageDeckModules, stageDeckLegPositions } from '../../src/shared/stageDeck.js';
import { studioSpec } from '../../src/shared/documentStudio.js';
import { trussCorners } from '../../src/shared/truss.js';
import { measuredOutline } from '../../src/shared/venue.js';
import { effectiveVenueDoorOpen, withVenueFixtureOpenings } from '../../src/shared/venueFixtures.js';
import { openingCorners, wallCorners } from '../../src/shared/wallPlan.js';
import { resolveWall, typesOf, type WallElementType } from '../../src/shared/wall-types.js';
import type { Wall, Brace } from '../../src/shared/layout.js';
import { createFontMeasure } from '../../src/server/exports/documentPdf.js';
import { INPUT_DECIMALS, normalise, stableJson, type Json } from './format.js';
import { GOLDEN_ISSUED_AT, GOLDEN_REVISION_ID, GOLDEN_REVISION_NAME, rawGoldenInputs, type GoldenInput } from './fixtures.js';
import { goldenFile, updatingGoldens } from './store.js';
import {
  braceSolids, placeholderSolids, platformSolids, solidBounds, stairSolids, wallSolids,
} from './solids.js';
import type { NeutralFootprints, NeutralSolids, NeutralSurfaces, NeutralWarning } from './types.js';

export type LoadedFixture = {
  name: string;
  description: string;
  scene: Scene;
  panels: InventoryPanel[];
  ballastStock: BallastStock;
  elevationGroupIds: string[];
  document: { paper: 'A3' | 'A4' | 'A2' | 'A1'; scale: 25 | 50 | 100 };
};

const sceneMetaSchema = z.object({
  id: z.uuid(), name: z.string(), productionId: z.uuid(), productionName: z.string(),
  venueId: z.uuid(), venueName: z.string(), venueVersionId: z.uuid(),
});

const storedInputSchema = z.object({
  name: z.string(), description: z.string(), scene: sceneMetaSchema,
  venue: z.unknown(), layout: z.unknown(), panels: z.array(z.unknown()),
  ballastStock: z.object({ slabs: z.number(), straps: z.number() }),
  elevationGroupIds: z.array(z.string()),
  document: z.object({ paper: z.enum(['A1', 'A2', 'A3', 'A4']), scale: z.union([z.literal(25), z.literal(50), z.literal(100)]) }),
});

export function parseFixture(raw: unknown): LoadedFixture {
  const input = storedInputSchema.parse(normalise(raw, INPUT_DECIMALS));
  const venue: VenueGeometry = venueGeometrySchema.parse(input.venue);
  const layout: Layout = layoutSchema.parse(input.layout);
  const panels = input.panels.map(panel => inventoryPanelSchema.parse(panel));
  return {
    name: input.name, description: input.description,
    scene: {
      id: input.scene.id, name: input.scene.name, productionName: input.scene.productionName,
      venueName: input.scene.venueName, productionId: input.scene.productionId, venueId: input.scene.venueId,
      venueVersionId: input.scene.venueVersionId, lease: null, revision: 0, venue, layout,
    },
    panels, ballastStock: input.ballastStock, elevationGroupIds: input.elevationGroupIds, document: input.document,
  };
}

/** The frozen, validated input of a fixture: what the stored `input.json` holds. */
export function storedInput(fixture: LoadedFixture): Json {
  const { scene } = fixture;
  return normalise({
    name: fixture.name, description: fixture.description,
    scene: {
      id: scene.id, name: scene.name, productionId: scene.productionId, productionName: scene.productionName,
      venueId: scene.venueId, venueName: scene.venueName, venueVersionId: scene.venueVersionId,
    },
    venue: venueGeometrySchema.encode(scene.venue), layout: scene.layout, panels: fixture.panels,
    ballastStock: fixture.ballastStock, elevationGroupIds: fixture.elevationGroupIds, document: fixture.document,
  }, INPUT_DECIMALS);
}

export function generatedFixtures(): LoadedFixture[] {
  return rawGoldenInputs().map((raw: GoldenInput) => parseFixture(raw));
}

let cache: LoadedFixture[] | undefined;

/** Reads the frozen `<fixture>/input.json` files; under UPDATE_GOLDENS=1 it regenerates them from fixtures.ts first. */
export function loadFixtures(): LoadedFixture[] {
  if (cache) return cache;
  const generated = generatedFixtures();
  if (updatingGoldens()) {
    for (const fixture of generated) {
      const file = goldenFile(fixture.name, 'input');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, stableJson(storedInput(fixture), INPUT_DECIMALS));
    }
  }
  cache = generated.map(fixture => {
    const file = goldenFile(fixture.name, 'input');
    if (!existsSync(file)) throw new Error(`Missing tests/golden/${fixture.name}/input.json. Run UPDATE_GOLDENS=1 npm test.`);
    return parseFixture(JSON.parse(readFileSync(file, 'utf8')));
  });
  return cache;
}

export function revisionOf(fixture: LoadedFixture) {
  return {
    id: GOLDEN_REVISION_ID, name: GOLDEN_REVISION_NAME, issuedAt: new Date(GOLDEN_ISSUED_AT),
    paper: fixture.document.paper, scale: fixture.document.scale, elevationGroupIds: fixture.elevationGroupIds,
  };
}

export function panelLabels(fixture: LoadedFixture) {
  return Object.fromEntries(fixture.panels.map(panel => [panel.id, panel.label]));
}

type ElementKind = 'wall' | 'brace' | 'platform' | 'stair' | 'placeholder';
type Source = 'venue' | 'layout';
type Element =
  | { kind: 'wall'; source: Source; id: string; label: string; data: Wall }
  | { kind: 'brace'; source: Source; id: string; label: string; data: Brace }
  | { kind: 'platform'; source: Source; id: string; label: string; data: Platform }
  | { kind: 'stair'; source: Source; id: string; label: string; data: StairUnit }
  | { kind: 'placeholder'; source: Source; id: string; label: string; data: Placeholder };

function elementsOf(scene: Scene): Element[] {
  const { venue, layout } = scene;
  const list: Element[] = [];
  const add = <K extends ElementKind>(kind: K, source: Source, items: readonly { id: string; label: string }[] | undefined) => {
    for (const data of items ?? []) list.push({ kind, source, id: data.id, label: data.label, data } as Element);
  };
  add('wall', 'venue', venue.walls);
  add('wall', 'layout', layout.walls);
  add('brace', 'layout', layout.braces);
  add('platform', 'venue', venue.platforms);
  add('platform', 'layout', layout.platforms);
  add('stair', 'venue', venue.stairs);
  add('stair', 'layout', layout.stairs);
  add('placeholder', 'venue', venue.placeholders);
  add('placeholder', 'layout', layout.placeholders);
  return list;
}

function resolvedWallOf(scene: Scene, element: Extract<Element, { kind: 'wall' }>) {
  const types = element.source === 'venue' ? scene.venue.wallTypes ?? [] : typesOf(scene.layout);
  return resolveWall(element.data, types as WallElementType[]);
}

function allPlatforms(scene: Scene): Platform[] {
  return [...scene.venue.platforms ?? [], ...scene.layout.platforms ?? []];
}

function elevationOf(scene: Scene, element: Element) {
  const surfaces = supportingSurfaces(scene.venue, scene.layout);
  switch (element.kind) {
    case 'platform': return element.data.elevation;
    case 'stair': return surfaceElevation(surfaces, element.data.lowerSurfaceId);
    default: return surfaceElevation(surfaces, element.data.supportingSurfaceId);
  }
}

const poly = (points: readonly { x: number; y: number }[]) => points.map(point => ({ x: point.x, y: point.y }));

export function captureFootprints(fixture: LoadedFixture) {
  const { scene } = fixture;
  const { venue, layout } = scene;
  const elements: Record<string, Json> = {};
  for (const element of elementsOf(scene)) {
    let polygon: { x: number; y: number }[];
    let extras: Record<string, unknown> | undefined;
    switch (element.kind) {
      case 'wall': {
        const resolved = resolvedWallOf(scene, element);
        polygon = wallCorners(resolved);
        extras = { openings: resolved.openings.map(opening => ({ id: opening.id, polygon: openingCorners(resolved, opening) })) };
        break;
      }
      case 'brace':
        polygon = braceCorners(element.data);
        extras = {
          timber: braceCorners({ ...element.data, ballast: undefined }),
          slabs: braceSlabFootprints(element.data),
        };
        break;
      case 'platform': polygon = poly(element.data.outline); break;
      case 'stair': polygon = stairCorners(element.data); break;
      case 'placeholder': polygon = placeholderCorners(element.data); break;
    }
    elements[element.id] = normalise({
      kind: element.kind, source: element.source, label: element.label, polygon: poly(polygon), ...extras,
    });
  }
  const fixtures: [string, string, { x: number; y: number }[]][] = [
    [AUDIENCE_FLOOR_ID, 'floor', measuredOutline(venue)],
    ...(venue.keepClearZones ?? []).map(zone => [zone.id, 'keepClear', zone.polygon] as [string, string, { x: number; y: number }[]]),
    ...(venue.overheadBoxes ?? []).map(box => [box.id, 'overhead', overheadBoxCorners(box)] as [string, string, { x: number; y: number }[]]),
    ...(venue.trusses ?? []).map(truss => [truss.id, 'truss', trussCorners(truss)] as [string, string, { x: number; y: number }[]]),
    ...(venue.curtains ?? []).map(curtain => [curtain.id, 'curtain', curtainCorners(curtain)] as [string, string, { x: number; y: number }[]]),
  ];
  for (const [id, kind, polygon] of fixtures) elements[id] = normalise({ kind, source: 'venue', polygon: poly(polygon) });
  void layout;
  return { units: 'mm, plan coordinates (+x audience-right, +y away from the audience)', elements };
}

export function captureSolids(fixture: LoadedFixture) {
  const { scene } = fixture;
  const { venue, layout } = scene;
  const surfaces = supportingSurfaces(venue, layout);
  const peers = allPlatforms(scene);
  const elements: Record<string, Json> = {};
  for (const element of elementsOf(scene)) {
    const elevation = elevationOf(scene, element);
    let solids;
    switch (element.kind) {
      case 'wall': {
        const resolved = resolvedWallOf(scene, element);
        const open = element.source === 'venue' ? effectiveVenueDoorOpen(element.data, layout) : element.data.doorOpenPercent ?? 0;
        solids = wallSolids(resolved as never, elevation, open, element.data.surfaces);
        break;
      }
      case 'brace': solids = braceSolids(element.data, elevation); break;
      case 'platform': solids = platformSolids(element.data, peers); break;
      case 'stair': solids = stairSolids(element.data, surfaces); break;
      case 'placeholder': solids = placeholderSolids(element.data, elevation); break;
    }
    const bounds = solidBounds(solids);
    elements[element.id] = normalise({
      v1Kind: element.kind, source: element.source, label: element.label, elevation,
      height: bounds.max.y - bounds.min.y, bbox: bounds, ...solids,
    });
  }
  return {
    units: {
      length: 'mm', angle: 'degrees',
      frame: 'x = plan x (audience-right), y = up, z = plan y (away from audience); unmirrored model space',
      rotation: 'Euler XYZ, Three.js convention',
    },
    elements,
  };
}

export function captureSurfaces(fixture: LoadedFixture): Json {
  const { scene } = fixture;
  const { venue, layout } = scene;
  const surfaces = supportingSurfaces(venue, layout);
  const resolved: Record<string, Json> = {};
  for (const element of elementsOf(scene)) {
    if (element.kind === 'platform') {
      resolved[element.id] = normalise({ v1Kind: 'platform', elevation: element.data.elevation, style: element.data.style ?? 'floating' });
    } else if (element.kind === 'stair') {
      resolved[element.id] = normalise({
        v1Kind: 'stair', lowerSurfaceId: element.data.lowerSurfaceId, upperSurfaceId: element.data.upperSurfaceId,
        elevation: surfaceElevation(surfaces, element.data.lowerSurfaceId), rise: stairRise(element.data, surfaces),
      });
    } else {
      resolved[element.id] = normalise({
        v1Kind: element.kind, supportingSurfaceId: element.data.supportingSurfaceId ?? null,
        elevation: surfaceElevation(surfaces, element.data.supportingSurfaceId),
      });
    }
  }
  const reassigned = reassignLayoutSupports(layout, venue);
  const autoSupport: Record<string, string> = {};
  for (const item of [...reassigned.walls, ...reassigned.braces, ...reassigned.placeholders ?? []]) {
    autoSupport[item.id] = item.supportingSurfaceId!;
  }
  const venueFootprints: Record<string, string> = {};
  for (const wall of venue.walls ?? []) {
    venueFootprints[wall.id] = resolveSupportingSurfaceId(
      stairCorners({ x: wall.x, y: wall.y, rotation: wall.rotation, width: wall.width, run: wall.thickness }), surfaces,
    );
  }
  return normalise({
    surfaces: surfaces.map(surface => ({
      id: surface.id, label: surface.label, elevation: surface.elevation, outline: poly(surface.outline),
      style: (surface as Partial<Platform>).style ?? null,
    })),
    resolved,
    autoSupport,
    venueWallAutoSupport: venueFootprints,
  });
}

const sortWarnings = (items: NeutralWarning[]) => items.toSorted((a, b) =>
  a.family.localeCompare(b.family) || a.kind.localeCompare(b.kind) || a.ids.join('|').localeCompare(b.ids.join('|'))
  || a.message.localeCompare(b.message));

export function neutralWarnings(fixture: LoadedFixture): NeutralWarning[] {
  const { venue, layout } = fixture.scene;
  const found: NeutralWarning[] = [];
  const placeholders = [...venue.placeholders ?? [], ...layout.placeholders ?? []];
  const sceneObjects = { ...layout, placeholders };
  for (const item of objectOverlapWarnings(sceneObjects)) {
    found.push({ family: 'overlap', kind: 'scene', ids: [item.aId, item.bId].sort(), message: item.message });
  }
  for (const item of objectOverlapWarnings({
    schemaVersion: 1, walls: venue.walls ?? [], braces: [],
    platforms: venue.platforms, stairs: venue.stairs, placeholders: venue.placeholders,
  })) {
    found.push({ family: 'overlap', kind: 'venue', ids: [item.aId, item.bId].sort(), message: item.message });
  }
  for (const item of keepClearWarnings(withVenueFixtureOpenings(venue, layout), sceneObjects)) {
    found.push({ family: 'keep-clear', kind: item.objectKind, ids: [item.zoneId, item.objectId], message: item.message });
  }
  for (const item of overheadClearance(layout, venue)) {
    found.push({ family: 'overhead', kind: item.kind, ids: [item.objectId, ...item.obstructionId ? [item.obstructionId] : []], message: item.message });
  }
  for (const item of layoutDiagnostics(layout, venue)) {
    found.push({ family: 'placement', kind: item.kind, ids: [item.objectId], message: item.message });
  }
  for (const item of inventoryWarnings(layout, fixture.panels)) {
    found.push({ family: 'inventory', kind: item.kind, ids: [...item.wallId ? [item.wallId] : [], ...item.panelId ? [item.panelId] : []], message: item.message });
  }
  return sortWarnings(found);
}

export function captureWarnings(fixture: LoadedFixture): Json {
  const warnings = neutralWarnings(fixture);
  const counts: Record<string, number> = {};
  for (const item of warnings) counts[item.family] = (counts[item.family] ?? 0) + 1;
  return normalise({ counts, warnings });
}

export function captureNeutralFootprints(fixture: LoadedFixture): NeutralFootprints {
  const captured = captureFootprints(fixture).elements as Record<string, { kind: string; polygon: { x: number; y: number }[] }>;
  return Object.fromEntries(Object.entries(captured).map(([id, item]) => [id, { kind: item.kind, polygon: item.polygon }]));
}

export function captureNeutralSolids(fixture: LoadedFixture): NeutralSolids {
  const captured = captureSolids(fixture).elements as Record<string, NeutralSolids[string]>;
  return Object.fromEntries(Object.entries(captured).map(([id, item]) => [id, {
    boxes: item.boxes, ...item.spheres ? { spheres: item.spheres } : {}, ...item.prisms ? { prisms: item.prisms } : {},
  }]));
}

export function captureNeutralSurfaces(fixture: LoadedFixture): NeutralSurfaces {
  const { scene } = fixture;
  const surfaces = supportingSurfaces(scene.venue, scene.layout);
  const elevations: Record<string, number> = {};
  for (const element of elementsOf(scene)) elevations[element.id] = elevationOf(scene, element);
  return { surfaces: surfaces.map(surface => ({ id: surface.id, outline: poly(surface.outline), elevation: surface.elevation })), elevations };
}

function wallDemandKey(wall: Wall, types: WallElementType[]) {
  const placement = placementType(wall, types);
  const type = types.find(item => item.id === wall.typeId);
  return {
    key: type ? `type:${type.name}` : `custom:${placement.width}x${placement.height}x${placement.thickness}+${placement.openings.length}`,
    placement,
  };
}

export function freezeFixtureSnapshot(fixture: LoadedFixture): ConstructionSnapshot {
  return freezeSnapshot(fixture.scene, revisionOf(fixture), panelLabels(fixture));
}

export function captureLists(fixture: LoadedFixture): Json {
  const { scene } = fixture;
  const { venue, layout } = scene;
  const types = typesOf(layout) as WallElementType[];
  const snapshot = freezeFixtureSnapshot(fixture);
  const pkg = freezePackage([scene], revisionOf(fixture), fixture.panels, fixture.ballastStock);

  const ballastParts = layout.braces.map(brace => {
    const parts = braceBallast(brace);
    return {
      id: brace.id, label: brace.label, mode: brace.ballast?.mode ?? 'none', ballastLabel: ballastLabel(brace.ballast),
      slabs: parts.filter(part => part.kind === 'slab').length,
      straps: parts.filter(part => part.kind === 'strap').length,
      buckles: parts.filter(part => part.kind === 'buckle').length,
      members: braceMembers(brace).map(member => ({ kind: member.kind, size: member.size })),
    };
  });

  const demand = new Map<string, { count: number; usable: number; walls: string[] }>();
  for (const wall of layout.walls) {
    const { key, placement } = wallDemandKey(wall, types);
    const entry = demand.get(key) ?? {
      count: 0, walls: [],
      usable: usablePanels(fixture.panels).filter(panel =>
        panel.type.width === placement.width && panel.type.height === placement.height
        && panel.type.thickness === placement.thickness && panel.type.openings.length === placement.openings.length).length,
    };
    entry.count += 1;
    entry.walls.push(wall.id);
    demand.set(key, entry);
  }

  const numbered = assignAssemblyNumbers(layout.walls);
  const labels = panelLabels(fixture);
  const assembly = numbered.toSorted((a, b) => a.assemblyNumber - b.assemblyNumber || a.id.localeCompare(b.id)).map(wall => ({
    id: wall.id, assemblyNumber: wall.assemblyNumber, stored: layout.walls.find(item => item.id === wall.id)?.assemblyNumber ?? null,
    caption: assemblyCaption(wall.assemblyNumber, wall.panelId ? labels[wall.panelId] : undefined),
  }));

  const deckSizes: Record<string, number> = {};
  const legSizes: Record<string, number> = {};
  let moduleTotal = 0, legTotal = 0;
  const decks = allPlatforms(scene).filter(platform => platform.style === 'stageDeck').map(platform => {
    const box = orientedPlatformBox(platform.outline);
    const modules = layoutStageDeckModules(box.width, box.depth, platform.deckGrain);
    const legs = stageDeckLegPositions(box.width, box.depth, platform.deckGrain);
    for (const module of modules) {
      const key = `${Math.max(module.width, module.depth)}x${Math.min(module.width, module.depth)}`;
      deckSizes[key] = (deckSizes[key] ?? 0) + 1;
    }
    legSizes[`${platform.elevation}`] = (legSizes[`${platform.elevation}`] ?? 0) + legs.length;
    moduleTotal += modules.length; legTotal += legs.length;
    return {
      id: platform.id, label: platform.label, width: box.width, depth: box.depth, elevation: platform.elevation,
      grain: platform.deckGrain ?? 0, modules: modules.map(module => ({ x: module.x, y: module.y, width: module.width, depth: module.depth })),
      legCount: legs.length,
    };
  });

  const dimensions = (layout.dimensions ?? []).map(dimension => ({ id: dimension.id, resolved: resolveDimension(dimension, venue, layout) ?? null }));
  const pivots = (layout.groups ?? []).map(group => ({ id: group.id, members: group.members, pivot: groupPivot(layout, group.id) ?? null }));

  return normalise({
    materials: sceneMaterials(layout),
    materialRequirements: materialRequirements([layout], fixture.ballastStock),
    braces: ballastParts,
    panelDemand: Object.fromEntries([...demand.entries()].toSorted(([a], [b]) => a.localeCompare(b))),
    assembly,
    package: {
      sceneLists: pkg.sceneLists, stock: pkg.stock,
      inventory: pkg.inventory.map(panel => ({ id: panel.id, label: panel.label, typeId: panel.typeId, available: panel.available })),
    },
    stageDecks: { modulesBySize: deckSizes, legsByElevation: legSizes, moduleTotal, legTotal, decks },
    cableSchedule: cableScheduleRows(layout.cableRuns ?? []),
    cableLengthsMm: (layout.cableRuns ?? []).map(run => ({ id: run.id, requiredMm: requiredCableLengthMm(run) })),
    elevations: elevationFaces(snapshot),
    dimensions,
    groups: pivots,
    planExtent: {
      scenery: planReportExtent(venue, layout, 'scenery'),
      venue: planReportExtent(venue, layout, 'venue'),
      contentBoundsScenery: contentBounds(snapshot, {}, 'scenery'),
      contentBoundsVenue: contentBounds(snapshot, {}, 'venue'),
    },
  });
}

export function documentSpecOf(fixture: LoadedFixture) {
  const spec = studioSpec('technical', [fixture.scene.id], GOLDEN_REVISION_NAME);
  return {
    ...spec, paper: fixture.document.paper, scale: fixture.document.scale,
    scenes: [{ sceneId: fixture.scene.id, elevationGroupIds: fixture.elevationGroupIds }],
  };
}

export function frozenSceneOf(fixture: LoadedFixture): FrozenScene {
  return {
    sceneId: fixture.scene.id, sceneName: fixture.scene.name, venueName: fixture.scene.venueName,
    snapshot: freezeFixtureSnapshot(fixture),
  };
}

let measure: ReturnType<typeof createFontMeasure> | undefined;

export function composeFixtureDocument(fixture: LoadedFixture) {
  measure ??= createFontMeasure();
  return composeDocument({
    spec: documentSpecOf(fixture), scenes: [frozenSceneOf(fixture)], productionName: fixture.scene.productionName,
    issuedAtLabel: germanDate(GOLDEN_ISSUED_AT), measure,
  });
}

export function captureDocument(fixture: LoadedFixture): Json {
  const snapshot = freezeFixtureSnapshot(fixture);
  const { venue: _venue, layout: _layout, ...frozen } = constructionSnapshotSchema.parse(snapshot);
  return normalise({ snapshot: frozen, document: composeFixtureDocument(fixture) });
}
