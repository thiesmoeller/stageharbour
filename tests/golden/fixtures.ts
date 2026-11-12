import type { BallastStock } from '../../src/shared/ballast.js';
import type { InventoryPanel } from '../../src/shared/inventory.js';
import type { Layout, VenueGeometry } from '../../src/shared/layout.js';
import type { PaperSize } from '../../src/shared/tiling.js';
import { createSeedSnapshot } from '../../src/client/local/seed.js';

/**
 * Golden inputs are written as plain data on purpose. They must keep working after the per-kind
 * builders (`newWall`, `groupWallType`, `STAGE_DECK_*`, ...) are deleted, so nothing here calls production
 * constructors. The same data is frozen as `tests/golden/<fixture>/input.json`.
 */
export type GoldenScene = {
  id: string; name: string; productionId: string; productionName: string;
  venueId: string; venueName: string; venueVersionId: string;
};

export type GoldenInput = {
  name: string;
  description: string;
  scene: GoldenScene;
  venue: VenueGeometry;
  layout: Layout;
  panels: InventoryPanel[];
  ballastStock: BallastStock;
  elevationGroupIds: string[];
  document: { paper: PaperSize; scale: 25 | 50 | 100 };
};

type Point = { x: number; y: number };

export const AUDIENCE_FLOOR = '00000000-0000-4000-8000-000000000001';
export const GOLDEN_PRODUCTION_ID = 'f0000000-0000-4000-8000-000000000001';
export const GOLDEN_ISSUED_AT = '2026-09-07T12:00:00.000Z';
export const GOLDEN_REVISION_ID = 'f1000000-0000-4000-8000-000000000001';
export const GOLDEN_REVISION_NAME = 'Goldene Fassung';

const KINDS = {
  wall: 1, brace: 2, platform: 3, stair: 4, placeholder: 5, type: 6, opening: 7, panel: 8, connection: 9,
  group: 10, cable: 11, picture: 12, asset: 13, zone: 14, truss: 15, curtain: 16, overhead: 17, pin: 18,
  corridor: 19, dimension: 20, hang: 21, measure: 22, meta: 23, assignment: 24,
} as const;

function idFactory(series: number) {
  const hex = (value: number) => value.toString(16).padStart(2, '0');
  return (kind: keyof typeof KINDS, n: number) =>
    `${hex(KINDS[kind])}${hex(series)}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const micro = (value: number) => Math.round(value * 1e6) / 1e6;

function rect(cx: number, cy: number, width: number, depth: number, rotation = 0): Point[] {
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => ({
    x: micro(cx + sx * width / 2 * cos - sy * depth / 2 * sin),
    y: micro(cy + sx * width / 2 * sin + sy * depth / 2 * cos),
  }));
}

type TypeOpening = {
  id: string; left: number; sill: number; width: number; height: number;
  hinge?: 'left' | 'right'; profile?: 'rectangle' | 'arch';
};
type WallTypeData = {
  id: string; name: string; width: number; height: number; thickness: number; openings: TypeOpening[];
};

function wallTypes(id: ReturnType<typeof idFactory>) {
  const plain: WallTypeData = { id: id('type', 1), name: 'Glattwand', width: 1200, height: 2400, thickness: 28, openings: [] };
  const doorLeft: WallTypeData = {
    id: id('type', 2), name: 'Türwand · Scharnier links', width: 1200, height: 2400, thickness: 28,
    openings: [{ id: id('opening', 1), left: 200, sill: 0, width: 800, height: 2000, hinge: 'left' }],
  };
  const doorRight: WallTypeData = {
    id: id('type', 3), name: 'Türwand · Scharnier rechts', width: 1200, height: 2400, thickness: 28,
    openings: [{ id: id('opening', 2), left: 200, sill: 0, width: 800, height: 2000, hinge: 'right' }],
  };
  const window: WallTypeData = {
    id: id('type', 4), name: 'Fensterwand', width: 1200, height: 2400, thickness: 28,
    openings: [{ id: id('opening', 3), left: 390, sill: 1100, width: 420, height: 900 }],
  };
  const arch: WallTypeData = {
    id: id('type', 5), name: 'Bogen', width: 1200, height: 2400, thickness: 250,
    openings: [{ id: id('opening', 4), left: 200, sill: 0, width: 800, height: 2000, profile: 'arch' }],
  };
  const half: WallTypeData = { id: id('type', 6), name: 'Halbe Wand', width: 600, height: 2400, thickness: 250, openings: [] };
  const wide: WallTypeData = {
    id: id('type', 7), name: 'Breite Mehrfachwand', width: 2400, height: 2600, thickness: 40,
    openings: [
      { id: id('opening', 5), left: 1500, sill: 0, width: 900, height: 2100, hinge: 'right' },
      { id: id('opening', 6), left: 300, sill: 1000, width: 500, height: 800 },
      { id: id('opening', 7), left: 900, sill: 300, width: 400, height: 1500, profile: 'arch' },
    ],
  };
  return { plain, doorLeft, doorRight, window, arch, half, wide };
}

type WallData = Record<string, unknown> & { id: string };

function wallOf(id: string, x: number, y: number, extra: Record<string, unknown> = {}): WallData {
  return {
    id, label: 'Wand', x, y, rotation: 0, width: 1200, height: 2400, thickness: 28,
    supportingSurfaceId: AUDIENCE_FLOOR, ...extra,
  };
}

function typedWall(
  id: string, type: WallTypeData, x: number, y: number, extra: Record<string, unknown> = {},
): WallData {
  return wallOf(id, x, y, {
    label: type.name, typeId: type.id, width: type.width, height: type.height, thickness: type.thickness, ...extra,
  });
}

function braceOf(id: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return {
    id, label: 'Stütze', x, y, rotation: 0, footprintWidth: 40, footprintDepth: 500, height: 1200,
    supportingSurfaceId: AUDIENCE_FLOOR, ...extra,
  };
}

function platformOf(
  id: string, label: string, elevation: number, outline: Point[], extra: Record<string, unknown> = {},
) {
  return { id, label, elevation, outline, ...extra };
}

function stairOf(
  id: string, lower: string, upper: string, x: number, y: number, rotation = 0, extra: Record<string, unknown> = {},
) {
  return {
    id, label: 'Treppe', lowerSurfaceId: lower, upperSurfaceId: upper, x, y, rotation,
    width: 1200, run: 2000, riserHeight: 160, ...extra,
  };
}

const PLACEHOLDER_SIZES = {
  table: { width: 1200, depth: 800, height: 750, label: 'Tisch' },
  chair: { width: 450, depth: 450, height: 900, label: 'Stuhl' },
  person: { width: 500, depth: 400, height: 1750, label: 'Person' },
  speaker: { width: 400, depth: 350, height: 600, label: 'Lautsprecher' },
  box: { width: 600, depth: 600, height: 600, label: 'Kiste' },
} as const;

function placeholderOf(
  kind: keyof typeof PLACEHOLDER_SIZES, id: string, x: number, y: number, extra: Record<string, unknown> = {},
) {
  const size = PLACEHOLDER_SIZES[kind];
  return {
    id, kind, label: size.label, x, y, rotation: 0, width: size.width, depth: size.depth, height: size.height,
    supportingSurfaceId: AUDIENCE_FLOOR, ...extra,
  };
}

function panelOf(
  id: string, label: string, type: WallTypeData, extra: Record<string, unknown> = {},
): InventoryPanel {
  return { id, label, typeId: type.id, available: true, note: null, type, ...extra } as InventoryPanel;
}

function sceneMeta(series: number, name: string, venueName: string): GoldenScene {
  const id = idFactory(series);
  return {
    id: id('meta', 1), name, productionId: GOLDEN_PRODUCTION_ID, productionName: 'Goldene Produktion',
    venueId: id('meta', 2), venueName, venueVersionId: id('meta', 3),
  };
}

function asInput<T>(value: unknown): T {
  return value as T;
}

function demoSeed(): GoldenInput {
  const snapshot = createSeedSnapshot();
  const version = snapshot.venueVersions[0]!;
  const scene = snapshot.scenes[0]!;
  return {
    name: 'demo-seed',
    description: 'The browser demo scene exactly as createSeedSnapshot() builds it: three plain walls on an empty 8 x 6 m hall, with the demo inventory.',
    scene: {
      id: scene.id, name: scene.name, productionId: scene.productionId,
      productionName: snapshot.productions[0]!.name, venueId: snapshot.venues[0]!.id,
      venueName: snapshot.venues[0]!.name, venueVersionId: version.id,
    },
    venue: asInput<VenueGeometry>(version.geometry),
    layout: asInput<Layout>(scene.layout),
    panels: asInput<InventoryPanel[]>(snapshot.inventory.panels),
    ballastStock: snapshot.inventory.ballast,
    elevationGroupIds: [],
    document: { paper: 'A4', scale: 50 },
  };
}

function kitchenSink(): GoldenInput {
  const id = idFactory(1);
  const t = wallTypes(id);
  const platformFloating = id('platform', 1), platformSolid = id('platform', 2), deckFlat = id('platform', 3);
  const deckGrain = id('platform', 4), deckRotated = id('platform', 5), deckStacked = id('platform', 6);
  const solidLow = id('platform', 7), venueStage = id('platform', 20), venueDeck = id('platform', 21);
  const w = (n: number) => id('wall', n);
  const b = (n: number) => id('brace', n);

  const walls: WallData[] = [
    typedWall(w(1), t.plain, 1000, 1500, {
      assemblyNumber: 1, panelId: id('panel', 1), label: 'Glattwand vorn',
      finishAssignment: {
        id: id('assignment', 1),
        surfaces: { front: { full: { kind: 'paint', ral: '9010' } }, edge: { kind: 'paint', ral: '9005' } },
      },
      surfaces: {
        front: { full: { kind: 'paint', ral: '9010' } },
        back: {
          splitMm: 1200,
          lower: { kind: 'library', ref: 'library:wood-finewood27', scaleMm: 800, rotationDeg: 90 },
          upper: { kind: 'paint', ral: '7016' },
        },
        edge: { kind: 'paint', ral: '9005' },
      },
    }),
    typedWall(w(2), t.doorLeft, 2200, 1500, {
      assemblyNumber: 2, panelId: id('panel', 2), doorOpenPercent: 50,
      surfaces: { front: { full: { kind: 'library', ref: 'library:color-white' } } },
    }),
    typedWall(w(3), t.doorRight, 3400, 1500, { assemblyNumber: 3, panelId: id('panel', 3), doorOpenPercent: 100 }),
    typedWall(w(4), t.window, 4600, 1500, {
      assemblyNumber: 4, panelId: id('panel', 4),
      surfaces: {
        front: { splitMm: 1000, lower: { kind: 'paint', ral: '6011' }, upper: { kind: 'paint', ral: '9001' } },
        back: { splitMm: 1000, upper: { kind: 'paint', ral: '8025' } },
      },
    }),
    typedWall(w(5), t.arch, 1000, 3500, { assemblyNumber: 5, panelId: id('panel', 5) }),
    typedWall(w(6), t.half, 2300, 3500, { rotation: 90, panelId: id('panel', 6) }),
    typedWall(w(7), t.wide, 4200, 3500, {
      assemblyNumber: 7, panelId: id('panel', 8), doorOpenPercent: 33.3,
      surfaces: { front: { splitMm: 1500, lower: { kind: 'paint', ral: '5010' }, upper: { kind: 'paint', ral: '1003' } } },
    }),
    wallOf(w(8), 7000, 2000, { rotation: 37.5, label: 'Schräge Wand', panelId: id('panel', 10) }),
    typedWall(w(9), t.half, 8500, 2000, { rotation: -22.5, panelId: id('panel', 12) }),
    wallOf(w(10), 10000, 2000, {
      label: 'Wand ohne Typ', width: 1800, height: 2200, thickness: 40, rotation: 15, doorOpenPercent: 25,
      openings: [
        { id: id('opening', 20), left: 300, sill: 0, width: 800, height: 2000, hinge: 'left' },
        { id: id('opening', 21), left: 1200, sill: 900, width: 400, height: 800 },
      ],
    }),
    wallOf(w(11), 11200, 4300, { label: 'Wand ohne Typ 90°', rotation: 90, width: 2000, height: 2000, thickness: 50 }),
    typedWall(w(12), t.plain, 7200, 4500, {
      rotation: 15, supportingSurfaceId: platformFloating, label: 'Glattwand auf Podest', panelId: id('panel', 7),
    }),
    typedWall(w(13), t.doorLeft, 9300, 7800, {
      supportingSurfaceId: venueStage, doorOpenPercent: 75, label: 'Türwand auf Seitenbühne', panelId: id('panel', 13),
    }),
    typedWall(w(14), t.plain, 3000, 5200, { supportingSurfaceId: deckFlat, label: 'Glattwand auf Bühnenelement', panelId: id('panel', 9) }),
  ];

  const braces = [
    braceOf(b(1), 1000, 2200, { label: 'Stütze ohne Ballast' }),
    braceOf(b(2), 2200, 2200, { label: 'Stütze einfach links', ballast: { mode: 'single', side: 'left' } }),
    braceOf(b(3), 3400, 2200, { label: 'Stütze einfach rechts', ballast: { mode: 'single', side: 'right' } }),
    braceOf(b(4), 4600, 2200, { label: 'Stütze schwer', ballast: { mode: 'heavy' } }),
    braceOf(b(5), 6000, 2500, {
      label: 'Große Stütze gedreht', rotation: 30, footprintWidth: 600, footprintDepth: 700, height: 2000,
      ballast: { mode: 'heavy' },
    }),
    braceOf(b(6), 7000, 3300, { label: 'Stütze auf Podest', supportingSurfaceId: platformFloating, ballast: { mode: 'none' } }),
    braceOf(b(7), 7800, 4200, {
      label: 'Stütze auf Podest einfach', supportingSurfaceId: platformFloating, rotation: -15,
      ballast: { mode: 'single', side: 'right' },
    }),
  ];

  const platforms = [
    platformOf(platformFloating, 'Schwebendes Trapezpodest', 300,
      [{ x: 6200, y: 3800 }, { x: 8200, y: 3800 }, { x: 7900, y: 5200 }, { x: 6500, y: 5200 }], {
        style: 'floating', surfaces: { top: { kind: 'library', ref: 'library:wood-finewood27' }, sides: { kind: 'paint', ral: '9010' } },
      }),
    platformOf(platformSolid, 'Massives Podest', 500, rect(10600, 6000, 2000, 1500), {
      style: 'solid', surfaces: { top: { kind: 'paint', ral: '7035' }, sides: { kind: 'library', ref: 'library:color-white' } },
    }),
    platformOf(solidLow, 'Niedriges Massivpodest', 200, rect(10600, 3500, 1000, 1000, 20), { style: 'solid' }),
    platformOf(deckFlat, 'Bühnenelement 4 x 2 m, 400', 400, rect(3000, 5600, 4000, 2000), { style: 'stageDeck', deckGrain: 0 }),
    platformOf(deckGrain, 'Bühnenelement Faser 90°, 600', 600, rect(1500, 7700, 3000, 2000), { style: 'stageDeck', deckGrain: 90 }),
    platformOf(deckRotated, 'Bühnenelement gedreht, 200', 200, rect(6000, 7600, 2000, 1000, 30), { style: 'stageDeck' }),
    platformOf(deckStacked, 'Bühnenelement gestapelt, 1000', 1000, rect(10600, 6000, 1000, 500), {
      style: 'stageDeck', deckGrain: 0, supportingSurfaceId: platformSolid,
    }),
    platformOf(id('platform', 8), 'Bühnenelement hoch, 1200', 1200, rect(6000, 1000, 1000, 1000), { style: 'stageDeck', deckGrain: 90 }),
  ];

  const stairs = [
    stairOf(id('stair', 1), AUDIENCE_FLOOR, platformFloating, 5600, 4500, 90),
    stairOf(id('stair', 2), platformSolid, deckStacked, 9200, 6000, 0, { label: 'Treppe auf Podest', width: 800, run: 800, riserHeight: 200 }),
    stairOf(id('stair', 3), AUDIENCE_FLOOR, solidLow, 9400, 3500, 20, { label: 'Gedrehte Treppe', width: 900, run: 600, riserHeight: 100 }),
  ];

  const placeholders = [
    placeholderOf('table', id('placeholder', 1), 5000, 600, { label: 'Tisch vorn' }),
    placeholderOf('chair', id('placeholder', 2), 4000, 700, { seatedFigure: true, label: 'Stuhl mit Figur' }),
    placeholderOf('chair', id('placeholder', 3), 3200, 700, { rotation: 45, label: 'Stuhl gedreht' }),
    placeholderOf('person', id('placeholder', 4), 6500, 700),
    placeholderOf('speaker', id('placeholder', 5), 10200, 800, { rotation: -30 }),
    placeholderOf('box', id('placeholder', 6), 10600, 6000, { supportingSurfaceId: platformSolid, label: 'Kiste auf Podest' }),
    placeholderOf('table', id('placeholder', 7), 3500, 5900, { supportingSurfaceId: deckFlat, label: 'Tisch auf Bühnenelement', rotation: 10 }),
    placeholderOf('person', id('placeholder', 8), 6000, 1000, { supportingSurfaceId: id('platform', 8), label: 'Person auf Bühnenelement' }),
  ];

  const groups = [
    {
      id: id('group', 1), rotation: 0,
      members: [
        { kind: 'wall', id: w(1) }, { kind: 'wall', id: w(2) }, { kind: 'wall', id: w(3) },
        { kind: 'wall', id: w(4) }, { kind: 'brace', id: b(1) },
      ],
    },
    {
      id: id('group', 2), rotation: 0,
      members: [
        { kind: 'wall', id: w(5) }, { kind: 'wall', id: w(6) }, { kind: 'wall', id: w(8) },
        { kind: 'brace', id: b(5) }, { kind: 'stair', id: id('stair', 1) }, { kind: 'placeholder', id: id('placeholder', 4) },
      ],
    },
  ];

  const panels: InventoryPanel[] = [
    panelOf(id('panel', 1), 'G-01', t.plain),
    panelOf(id('panel', 2), 'T-01', t.doorLeft),
    panelOf(id('panel', 3), 'T-02', t.doorRight),
    panelOf(id('panel', 4), 'F-01', t.window),
    panelOf(id('panel', 5), 'B-01', t.arch),
    panelOf(id('panel', 6), 'H-01', t.half),
    panelOf(id('panel', 7), 'G-02', t.plain, { note: 'Reserve' }),
    panelOf(id('panel', 8), 'M-01', t.wide),
    panelOf(id('panel', 9), 'G-03', t.plain),
    panelOf(id('panel', 10), 'G-04', t.plain),
    panelOf(id('panel', 11), 'G-05', t.plain, { available: false, note: 'Defekt' }),
    panelOf(id('panel', 12), 'H-02', t.half),
    panelOf(id('panel', 13), 'T-03', t.doorLeft),
  ];

  const venue = {
    schemaVersion: 1, width: 12000, depth: 9000,
    floorFinish: 'library:wood-finewood27',
    ceilingHeight: 5000,
    walls: [
      wallOf(id('wall', 40), 6000, 8900, {
        label: 'Hallenrückwand', width: 12000, height: 4200, thickness: 300, supportingSurfaceId: AUDIENCE_FLOOR,
        doorOpenPercent: 40,
        openings: [
          { id: id('opening', 40), left: 1000, sill: 0, width: 1000, height: 2100, hinge: 'right' },
          { id: id('opening', 41), left: 4000, sill: 1000, width: 1500, height: 1200 },
        ],
      }),
      typedWall(id('wall', 41), t.doorLeft, 300, 4500, {
        rotation: 90, label: 'Seitentür', thickness: 28, supportingSurfaceId: AUDIENCE_FLOOR,
      }),
    ],
    wallTypes: [t.doorLeft],
    platforms: [
      platformOf(venueStage, 'Seitenbühne', 400, rect(10000, 7750, 4000, 2500), { style: 'floating' }),
      platformOf(venueDeck, 'Fest installiertes Bühnenelement', 600, rect(500, 1000, 1000, 1000), { style: 'stageDeck', deckGrain: 0 }),
    ],
    stairs: [stairOf(id('stair', 20), AUDIENCE_FLOOR, venueStage, 7500, 7750, -90, { label: 'Treppe zur Seitenbühne' })],
    placeholders: [
      ...[0, 1, 2].flatMap(column => [0, 1].map(row =>
        placeholderOf('chair', id('placeholder', 30 + row * 3 + column), 3300 + column * 500, 8000 + row * 500, {
          label: `Parkett ${row * 3 + column + 1}`,
        }))),
    ],
    curtains: [
      { id: id('curtain', 1), label: 'Vorhang vorn', x: 6000, y: 700, rotation: 0, length: 8000, height: 4500, bottomClearance: 0, openPercent: 0, opening: 'traveler' },
      { id: id('curtain', 2), label: 'Vorhang Seite', x: 11800, y: 2500, rotation: 90, length: 3000, height: 4200, bottomClearance: 100, openPercent: 60, opening: 'stackLeft' },
    ],
    trusses: [
      {
        id: id('truss', 1), label: 'Traverse vorn', x: 6000, y: 2500, rotation: 0, length: 6000, sectionWidth: 400,
        bottomHeight: 3500, thickness: 300, hangPoints: [{ id: id('hang', 1), offsetMm: -2000 }, { id: id('hang', 2), offsetMm: 0 }, { id: id('hang', 3), offsetMm: 2000 }],
      },
      {
        id: id('truss', 2), label: 'Traverse schräg', x: 9000, y: 5000, rotation: 20, length: 3000, sectionWidth: 300,
        bottomHeight: 4000, thickness: 250, hangPoints: [],
      },
    ],
    overheadBoxes: [
      { id: id('overhead', 1), label: 'Lüftungskanal', x: 10000, y: 3000, rotation: 10, length: 3000, width: 700, bottomHeight: 2600, thickness: 400 },
    ],
    keepClearZones: [
      {
        id: id('zone', 1), label: 'Notausgang Ost', reason: 'Notausgang', supportingSurfaceId: AUDIENCE_FLOOR,
        polygon: [{ x: 11000, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 1200 }, { x: 11000, y: 1200 }],
      },
    ],
    connectionPoints: [
      { id: id('pin', 1), kind: 'power', label: 'Lichtstrom', x: 500, y: 8500 },
      { id: id('pin', 2), kind: 'audio', label: 'Tonanschluss', x: 11500, y: 500, notes: 'Wandkasten' },
    ],
    cableRoutingCorridors: [
      { id: id('corridor', 1), label: 'Kabelkanal Süd', path: [{ x: 500, y: 8500 }, { x: 500, y: 4000 }, { x: 5000, y: 600 }] },
    ],
    stageCentreline: { x: 6000, y: 4500, rotation: 90 },
    audienceViewpoint: { x: 6000, y: -2000, heightMm: 1600, targetX: 6000, targetY: 4500, targetHeightMm: 1200, label: 'Publikumssicht' },
  };

  const layout = {
    schemaVersion: 1,
    wallTypes: [t.plain, t.doorLeft, t.doorRight, t.window, t.arch, t.half, t.wide],
    walls, braces, platforms, stairs, placeholders, groups,
    connections: [
      { id: id('connection', 1), a: w(1), b: w(2) },
      { id: id('connection', 2), a: w(2), b: w(3) },
      { id: id('connection', 3), a: w(3), b: w(4) },
    ],
    cableRuns: [
      {
        id: id('cable', 1), label: 'Hauptstrom', purpose: 'power', cableType: 'CEE 16 A', quantity: 2, slackMm: 1500,
        start: { label: 'Technikstand', x: 500, y: 8500, connectionPointId: id('pin', 1) },
        end: { label: 'Bühne', x: 3000, y: 4200 },
        path: [{ x: 500, y: 8500 }, { x: 500, y: 4200 }, { x: 3000, y: 4200 }],
      },
      {
        id: id('cable', 2), label: 'Ton', purpose: 'audio', cableType: 'XLR', quantity: 1, slackMm: 0,
        start: { label: 'Wandkasten', x: 11500, y: 500, connectionPointId: id('pin', 2) },
        end: { label: 'Lautsprecher', x: 11000, y: 800 },
        path: [{ x: 11500, y: 500 }, { x: 11000, y: 800 }],
      },
    ],
    measureLines: [{ id: id('measure', 1), x1: 1000, y1: 1000, x2: 4600, y2: 1000, label: 'Frontbreite' }],
    dimensions: [
      { id: id('dimension', 1), orientation: 'horizontal', offset: 400, a: { kind: 'wall', scope: 'scene', wallId: w(1), corner: 0 }, b: { kind: 'wall', scope: 'scene', wallId: w(4), corner: 1 } },
      { id: id('dimension', 2), orientation: 'vertical', offset: 12500, a: { kind: 'outline', index: 1 }, b: { kind: 'outline', index: 2 } },
      { id: id('dimension', 3), orientation: 'aligned', offset: -300, a: { kind: 'platformEdge', scope: 'scene', platformId: platformFloating, edge: 0, t: 0.5 }, b: { kind: 'brace', braceId: b(6), corner: 2 } },
    ],
    wallPictures: [
      { id: id('picture', 1), wallId: w(1), face: 'front', assetId: id('asset', 1), along: 200, heightAboveFloor: 1200, width: 600, height: 800, note: 'Auf Angelschnur' },
      { id: id('picture', 2), wallId: w(8), face: 'back', assetId: id('asset', 2), along: 400, heightAboveFloor: 900, width: 400, height: 500 },
    ],
    riggingNotes: 'Alle Scharniere nach dem Aufbau prüfen. Stützen mit Gehwegplatten beschweren.',
    venueFixtureState: {
      curtains: [{ id: id('curtain', 1), openPercent: 25 }],
      doors: [{ wallId: id('wall', 40), doorOpenPercent: 70 }],
    },
  };

  return {
    name: 'kitchen-sink',
    description: 'Every element kind and geometry option: all wall types, rotations, door states, surface finishes, hinge connections, ballast modes, every platform style (one rotated, one stacked), stairs, placeholders, groups, panel assignments, cables, dimensions, wall pictures and a venue shell.',
    scene: sceneMeta(1, 'Alles-Szene', 'Großer Probensaal'),
    venue: asInput<VenueGeometry>(venue),
    layout: asInput<Layout>(layout),
    panels,
    ballastStock: { slabs: 4, straps: 2 },
    elevationGroupIds: [id('group', 1), id('group', 2)],
    document: { paper: 'A3', scale: 50 },
  };
}

function tipWall(id: string, label: string, angle: number, tipX: number, tipY: number): WallData {
  const radians = angle * Math.PI / 180;
  return wallOf(id, micro(tipX - 600 * Math.cos(radians)), micro(tipY - 600 * Math.sin(radians)), { label, rotation: angle });
}

function warningsFixture(): GoldenInput {
  const id = idFactory(2);
  const t = wallTypes(id);
  const w = (n: number) => id('wall', n);
  const stagePlatform = id('platform', 20), podiumA = id('platform', 1), podiumB = id('platform', 2);
  const raised = id('platform', 3), tall = id('platform', 4);

  const walls: WallData[] = [
    wallOf(w(1), 9500, 1500, { label: 'Kreuz A' }),
    wallOf(w(2), 9500, 1500, { label: 'Kreuz B', rotation: 90 }),
    wallOf(w(3), 3000, 1000, { label: 'Links' }),
    wallOf(w(4), 4200, 1000, { label: 'Rechts bündig' }),
    wallOf(w(5), 6000, 1000, { label: 'Waagerecht' }),
    tipWall(w(6), 'Spitze an Fläche', 28, 6000, 1000 - 14),
    wallOf(w(7), 8000, 1000, { label: 'Durchbohrt A' }),
    tipWall(w(8), 'Durchbohrt B', 28, 8000, 1000),
    wallOf(w(9), 1000, 500, { label: 'Auf Freihaltezone' }),
    wallOf(w(10), 5200, 3500, { label: 'Wand ohne Auflage', supportingSurfaceId: undefined }),
    wallOf(w(11), 6600, 3500, { label: 'Wand unbekannte Auflage', supportingSurfaceId: id('platform', 99) }),
    wallOf(w(12), 7800, 5200, { label: 'Hohe Wand auf Podest', supportingSurfaceId: stagePlatform }),
    wallOf(w(13), 4000, 5200, { label: 'Wand unter Kanal', supportingSurfaceId: stagePlatform }),
    wallOf(w(14), 2500, 5200, { label: 'Wand auf Podest A', supportingSurfaceId: podiumA }),
    typedWall(w(15), t.plain, 8800, 3500, { label: 'Ohne Platte 1' }),
    typedWall(w(16), t.plain, 8800, 4300, { label: 'Ohne Platte 2' }),
    typedWall(w(17), t.plain, 10100, 3500, { label: 'Fehlende Platte', panelId: id('panel', 90) }),
    typedWall(w(18), t.plain, 10100, 4300, { label: 'Nicht verfügbar', panelId: id('panel', 2) }),
    typedWall(w(19), t.doorLeft, 10100, 5100, { label: 'Falscher Typ', panelId: id('panel', 3) }),
    typedWall(w(20), t.plain, 11400, 3500, { label: 'Doppelt A', panelId: id('panel', 1) }),
    typedWall(w(21), t.plain, 11400, 4300, { label: 'Doppelt B', panelId: id('panel', 1) }),
    typedWall(w(22), t.half, 11400, 5100, { label: 'Halbe ohne Bestand' }),
    wallOf(w(23), 3600, 2800 - 14, { label: 'Kante Berührung' }),
    wallOf(w(24), 5000, 2800 - 15, { label: 'Ein Millimeter' }),
    wallOf(w(25), 6400, 2800 - 16, { label: 'Zwei Millimeter Abstand' }),
    typedWall(w(26), t.plain, 5600, 6300, {
      label: 'Veraltete Maße auf Podest', height: 2000, width: 1000, thickness: 20, supportingSurfaceId: stagePlatform,
    }),
  ];

  const braces = [
    braceOf(id('brace', 1), 500, 500, { label: 'Stütze auf Zone' }),
    braceOf(id('brace', 2), 5600, 1000, { label: 'Stütze an Wand', footprintWidth: 600 }),
    braceOf(id('brace', 3), 7500, 3200, { label: 'Stütze ohne Auflage', supportingSurfaceId: undefined }),
    braceOf(id('brace', 4), 7400, 5200, {
      label: 'Hohe Stütze auf Podest', height: 2400, supportingSurfaceId: stagePlatform, ballast: { mode: 'heavy' },
    }),
    braceOf(id('brace', 5), 1500, 2500, { label: 'Stütze unbekannte Auflage', supportingSurfaceId: id('platform', 98) }),
  ];

  const platforms = [
    platformOf(podiumA, 'Podest A', 400, rect(2500, 4000, 2000, 1500), { style: 'floating' }),
    platformOf(podiumB, 'Podest B', 600, rect(3100, 4300, 2000, 1500), { style: 'solid' }),
    platformOf(raised, 'Podest auf Zone', 300, rect(1200, 600, 1000, 800), { style: 'floating' }),
    platformOf(tall, 'Hohes Podest', 2400, rect(8200, 6200, 1200, 1200), { style: 'solid' }),
  ];

  const stairs = [
    stairOf(id('stair', 1), AUDIENCE_FLOOR, podiumA, 1200, 1300, 0, { label: 'Treppe auf Zone' }),
    stairOf(id('stair', 2), AUDIENCE_FLOOR, id('platform', 97), 5000, 4800, 0, { label: 'Treppe unbekannt' }),
    stairOf(id('stair', 3), podiumA, podiumB, 3200, 4300, 0, { label: 'Treppe zwischen Podesten' }),
  ];

  const placeholders = [
    placeholderOf('box', id('placeholder', 1), 1200, 500, { label: 'Kiste auf Zone' }),
    placeholderOf('chair', id('placeholder', 2), 6500, 2000, { label: 'Stuhl ohne Auflage', supportingSurfaceId: undefined }),
    placeholderOf('table', id('placeholder', 3), 5000, 4800, { label: 'Tisch auf Treppe' }),
    placeholderOf('person', id('placeholder', 4), 9500, 1500, { label: 'Person im Kreuz' }),
    placeholderOf('speaker', id('placeholder', 5), 6200, 2000, { label: 'Lautsprecher unbekannt', supportingSurfaceId: id('platform', 96) }),
  ];

  const panels: InventoryPanel[] = [
    panelOf(id('panel', 1), 'G-01', t.plain),
    panelOf(id('panel', 2), 'G-02', t.plain, { available: false, note: 'Reparatur' }),
    panelOf(id('panel', 3), 'G-03', t.plain),
    panelOf(id('panel', 4), 'G-04', t.plain),
  ];

  const venue = {
    schemaVersion: 1, width: 12000, depth: 7000,
    outline: [
      { x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 7000 }, { x: 3000, y: 7000 }, { x: 3000, y: 5800 }, { x: 0, y: 5800 },
    ],
    ceilingHeight: 2600,
    walls: [wallOf(id('wall', 50), 11800, 6000, { label: 'Hallenpfeiler', width: 400, height: 3000, thickness: 400 })],
    placeholders: [placeholderOf('chair', id('placeholder', 50), 11800, 6100, { label: 'Stuhl am Pfeiler' })],
    platforms: [platformOf(stagePlatform, 'Hauptbühne', 400, rect(6500, 5700, 6000, 2000), { style: 'floating' })],
    overheadBoxes: [
      { id: id('overhead', 1), label: 'Lüftungskanal', x: 4000, y: 5200, rotation: 0, length: 3000, width: 800, bottomHeight: 2000, thickness: 400 },
    ],
    trusses: [
      { id: id('truss', 1), label: 'Traverse', x: 7800, y: 5200, rotation: 0, length: 2000, sectionWidth: 400, bottomHeight: 2200, thickness: 300, hangPoints: [] },
    ],
    keepClearZones: [
      {
        id: id('zone', 1), label: 'Notausgang West', reason: 'Notausgang', supportingSurfaceId: AUDIENCE_FLOOR,
        polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }],
      },
      {
        id: id('zone', 2), label: 'Fluchtweg Mitte', reason: 'Fluchtweg', supportingSurfaceId: AUDIENCE_FLOOR,
        polygon: [{ x: 3000, y: 2800 }, { x: 7200, y: 2800 }, { x: 7200, y: 3200 }, { x: 3000, y: 3200 }],
      },
    ],
  };

  const layout = {
    schemaVersion: 1,
    wallTypes: [t.plain, t.doorLeft, t.half],
    walls, braces, platforms, stairs, placeholders,
  };
  return {
    name: 'warnings',
    description: 'Deliberately triggers every warning family: overlaps (and the contact cases that must not warn), keep-clear (including the 1 mm tolerance edge), ceiling and overhead conflicts, missing/unknown supporting surface, and every inventory warning kind.',
    scene: sceneMeta(2, 'Warn-Szene', 'L-förmige Halle'),
    venue: asInput<VenueGeometry>(venue),
    layout: asInput<Layout>(layout),
    panels,
    ballastStock: { slabs: 1, straps: 0 },
    elevationGroupIds: [],
    document: { paper: 'A4', scale: 100 },
  };
}

function wallTypesFixture(): GoldenInput {
  const id = idFactory(3);
  const t = wallTypes(id);
  const w = (n: number) => id('wall', n);
  const walls: WallData[] = [];
  let n = 1;
  const kinds = [t.plain, t.doorLeft, t.doorRight, t.window, t.arch, t.half, t.wide];
  const open = [0, 25, 50, 100];
  kinds.forEach((type, row) => {
    open.forEach((percent, column) => {
      const hasDoor = type.openings.some(opening => opening.hinge);
      if (!hasDoor && percent > 0) return;
      walls.push(typedWall(w(n++), type, 1500 + column * 3000, 1000 + row * 1800, {
        doorOpenPercent: percent || undefined,
        label: `${type.name} ${percent} %`,
      }));
    });
  });
  const rotations = [0, 15, 45, 90, 135, 180, 270, -45];
  rotations.forEach((rotation, index) => {
    walls.push(typedWall(w(n++), index % 2 ? t.doorRight : t.doorLeft, 2000 + index * 1800, 14500, {
      rotation, doorOpenPercent: 60, label: `Tür ${rotation}°`,
    }));
  });
  const bands = [
    { front: { full: { kind: 'paint', ral: '3020' } }, back: { full: { kind: 'library', ref: 'library:color-white', scaleMm: 600, rotationDeg: 180 } }, edge: { kind: 'paint', ral: '9005' } },
    { front: { splitMm: 800, lower: { kind: 'paint', ral: '5010' }, upper: { kind: 'paint', ral: '9016' } }, back: { splitMm: 2000, lower: { kind: 'paint', ral: '7040' } } },
    { front: { splitMm: 2399, upper: { kind: 'paint', ral: '1003' } }, back: { splitMm: 1, lower: { kind: 'paint', ral: '6011' }, upper: { kind: 'paint', ral: '8025' } } },
  ];
  bands.forEach((surfaces, index) => {
    walls.push(typedWall(w(n++), index === 1 ? t.arch : t.wide, 2000 + index * 3000, 17000, { surfaces, label: `Beflächung ${index + 1}` }));
  });
  walls.push(typedWall(w(n++), t.plain, 11500, 17000, {
    label: 'Veraltete Maße', width: 1000, height: 2000, thickness: 20, doorOpenPercent: 40,
  }));
  const venue = {
    schemaVersion: 1, width: 14000, depth: 19000,
    walls: [
      wallOf(id('wall', 80), 7000, 18500, {
        label: 'Hallenwand mit Tür', width: 6000, height: 3500, thickness: 250, doorOpenPercent: 10,
        openings: [
          { id: id('opening', 80), left: 500, sill: 0, width: 900, height: 2100, hinge: 'left' },
          { id: id('opening', 81), left: 3000, sill: 0, width: 1000, height: 2200, hinge: 'right', profile: 'arch' },
        ],
      }),
    ],
  };
  const layout = {
    schemaVersion: 1,
    wallTypes: [t.plain, t.doorLeft, t.doorRight, t.window, t.arch, t.half, t.wide],
    walls: walls.map(wall => ({ ...wall, supportingSurfaceId: AUDIENCE_FLOOR })),
    braces: [],
    venueFixtureState: { doors: [{ wallId: id('wall', 80), doorOpenPercent: 90 }] },
  };
  return {
    name: 'wall-types',
    description: 'Every wall type at several door open percentages, door walls at non-right rotations, and banded or per-face surface finishes (mesh groups) on arch and multi-opening panels.',
    scene: sceneMeta(3, 'Wandtypen-Szene', 'Sehr großer Saal'),
    venue: asInput<VenueGeometry>(venue),
    layout: asInput<Layout>(layout),
    panels: [],
    ballastStock: { slabs: 0, straps: 0 },
    elevationGroupIds: [],
    document: { paper: 'A4', scale: 100 },
  };
}

function stageDecksFixture(): GoldenInput {
  const id = idFactory(4);
  const t = wallTypes(id);
  const decks: { size: [number, number]; elevation: number; grain?: 0 | 90; rotation?: number; at: [number, number]; on?: string }[] = [
    { size: [2000, 1000], elevation: 200, at: [1500, 1000] },
    { size: [2000, 1000], elevation: 400, grain: 90, at: [4500, 1000] },
    { size: [3500, 1500], elevation: 600, at: [8500, 1500] },
    { size: [3500, 1500], elevation: 800, grain: 90, at: [13000, 1500] },
    { size: [500, 500], elevation: 1000, at: [1000, 4000] },
    { size: [1500, 500], elevation: 1200, grain: 0, at: [3500, 4000] },
    { size: [2000, 2000], elevation: 400, at: [7000, 4000] },
    { size: [2000, 2000], elevation: 400, grain: 90, at: [10500, 4000] },
    { size: [5000, 2500], elevation: 600, at: [4000, 8000] },
    { size: [4000, 3000], elevation: 400, rotation: 90, at: [10000, 8000] },
    { size: [2500, 1500], elevation: 200, rotation: 45, at: [14500, 8000] },
    { size: [1000, 1000], elevation: 1000, at: [16500, 4000] },
  ];
  const platforms: Record<string, unknown>[] = decks.map((deck, index) => platformOf(
    id('platform', index + 1), `Bühnenelement ${index + 1}`, deck.elevation,
    rect(deck.at[0], deck.at[1], deck.size[0], deck.size[1], deck.rotation ?? 0),
    { style: 'stageDeck', deckGrain: deck.grain ?? 0 },
  ));
  const base = id('platform', 20);
  platforms.push(platformOf(base, 'Massiver Unterbau', 300, rect(5000, 12000, 6000, 3000), { style: 'solid' }));
  platforms.push(platformOf(id('platform', 21), 'Bühnenelement auf Unterbau', 900, rect(4000, 12000, 2000, 2000), {
    style: 'stageDeck', deckGrain: 0, supportingSurfaceId: base,
  }));
  platforms.push(platformOf(id('platform', 22), 'Bühnenelement auf Unterbau 2', 1200, rect(6200, 12000, 2000, 1000), {
    style: 'stageDeck', deckGrain: 90, supportingSurfaceId: base,
  }));
  const layout = {
    schemaVersion: 1,
    wallTypes: [t.plain],
    walls: [typedWall(id('wall', 1), t.plain, 4000, 12000, { supportingSurfaceId: id('platform', 21) })],
    braces: [],
    platforms,
    stairs: [stairOf(id('stair', 1), AUDIENCE_FLOOR, id('platform', 1), 1500, 2500, 0, { riserHeight: 200 })],
  };
  return {
    name: 'stage-decks',
    description: 'Bühnenelemente of many sizes, grains, leg heights and rotations (including odd 0,5 m tilings), plus decks stacked on a solid base so legs land on lower surfaces.',
    scene: sceneMeta(4, 'Bühnenelement-Szene', 'Weite Halle'),
    venue: asInput<VenueGeometry>({ schemaVersion: 1, width: 18000, depth: 14000 }),
    layout: asInput<Layout>(layout),
    panels: [],
    ballastStock: { slabs: 0, straps: 0 },
    elevationGroupIds: [],
    document: { paper: 'A4', scale: 100 },
  };
}

export function rawGoldenInputs(): GoldenInput[] {
  return [demoSeed(), kitchenSink(), warningsFixture(), wallTypesFixture(), stageDecksFixture()];
}
