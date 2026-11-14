import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Built-in lighting fixture types for hang planning. Not manufacturer GDTF. */
export const builtInFixtureTypes = {
  fresnel: {
    id: 'fresnel',
    label: 'Fresnel',
    defaultBeam: 50,
    barnDoorsCapable: true,
  },
  flood: {
    id: 'flood',
    label: 'Flood',
    defaultBeam: 90,
    barnDoorsCapable: true,
  },
  wash: {
    id: 'wash',
    label: 'Wash',
    defaultBeam: 70,
    barnDoorsCapable: false,
  },
} as const;

export type BuiltInFixtureTypeId = keyof typeof builtInFixtureTypes;
export const fixtureTypeIdSchema = z.enum(['fresnel', 'flood', 'wash']);

/** Four flap angles in degrees (0 = open / out of beam, 90 = fully closed into beam). */
export const barnDoorFlapsSchema = z.strictObject({
  top: z.number().finite().min(0).max(90),
  bottom: z.number().finite().min(0).max(90),
  stageLeft: z.number().finite().min(0).max(90),
  stageRight: z.number().finite().min(0).max(90),
});
export type BarnDoorFlaps = z.infer<typeof barnDoorFlapsSchema>;
export const openBarnDoors: BarnDoorFlaps = { top: 0, bottom: 0, stageLeft: 0, stageRight: 0 };

/**
 * Physical aim / beam shape set once on the hang (ladder work).
 * Omitted pan/tilt → aim toward stage centre at render time (Capture-style default focus).
 */
export const fixtureFocusSchema = z.strictObject({
  /** Pan degrees relative to straight down (positive = stage left / −X). */
  pan: z.number().finite().min(-180).max(180).optional(),
  /** Tilt degrees (0 = straight down). */
  tilt: z.number().finite().min(-90).max(90).optional(),
  /** Beam opening in degrees before barn-door clipping. */
  beam: z.number().finite().min(10).max(120).optional(),
  barnDoors: barnDoorFlapsSchema.optional(),
});
export type FixtureFocus = z.infer<typeof fixtureFocusSchema>;

/**
 * A Scheinwerfer hung on a Traverse hang point (venue hang plan).
 * Focus (pan/tilt/beam/flaps) lives on the hang — not on light looks.
 */
export const lightingFixtureSchema = z.strictObject({
  id: z.uuid(),
  label: name,
  typeId: fixtureTypeIdSchema,
  trussId: z.uuid(),
  hangPointId: z.uuid(),
  /** Physical barn doors attached on the hang (flap angles live on focus). */
  barnDoorsAttached: z.boolean().default(false),
  focus: fixtureFocusSchema.optional(),
}).refine(
  fixture => !fixture.barnDoorsAttached || builtInFixtureTypes[fixture.typeId].barnDoorsCapable,
  'Barn doors require a barn-door-capable fixture type',
);

export type LightingFixture = z.infer<typeof lightingFixtureSchema>;

export const hangPlanSchema = z.strictObject({
  fixtures: z.array(lightingFixtureSchema).max(500).default([]),
}).refine(
  plan => new Set(plan.fixtures.map(item => item.id)).size === plan.fixtures.length,
  'Lighting fixture IDs must be unique',
).refine(
  plan => new Set(plan.fixtures.map(item => item.hangPointId)).size === plan.fixtures.length,
  'Each hang point may hold at most one lighting fixture',
);

export type HangPlan = z.infer<typeof hangPlanSchema>;
export const emptyHangPlan: HangPlan = { fixtures: [] };

export function fixtureTypeLabel(typeId: BuiltInFixtureTypeId): string {
  return builtInFixtureTypes[typeId].label;
}

export function defaultBarnDoorsAttached(typeId: BuiltInFixtureTypeId): boolean {
  return builtInFixtureTypes[typeId].barnDoorsCapable;
}

/** Validate hang plan against venue truss hang points. */
export function hangPlanFitsTrusses(
  plan: HangPlan,
  trusses: readonly { id: string; hangPoints: readonly { id: string }[] }[],
): boolean {
  const hangByTruss = new Map(trusses.map(truss => [truss.id, new Set(truss.hangPoints.map(point => point.id))]));
  return plan.fixtures.every(fixture => hangByTruss.get(fixture.trussId)?.has(fixture.hangPointId));
}

export function newLightingFixture(
  id: string,
  trussId: string,
  hangPointId: string,
  typeId: BuiltInFixtureTypeId = 'fresnel',
  extras?: Partial<Pick<LightingFixture, 'label' | 'barnDoorsAttached' | 'focus'>>,
): LightingFixture {
  return {
    id,
    label: extras?.label ?? builtInFixtureTypes[typeId].label,
    typeId,
    trussId,
    hangPointId,
    barnDoorsAttached: extras?.barnDoorsAttached ?? defaultBarnDoorsAttached(typeId),
    ...(extras?.focus ? { focus: extras.focus } : {}),
  };
}

/** Venue default aim: toward stage centre from hang world (plan millimetres). */
export function defaultFocusTowardCentre(
  hang: { x: number; y: number; z: number },
  venueWidthMm: number,
  venueDepthMm: number,
): FixtureFocus {
  return focusTowardPoint(hang, { x: venueWidthMm / 2, z: venueDepthMm / 2 });
}

/** Floor hit of hang→aim ray (y=0) plus approximate pool radius from beam. */
export function fixtureFloorPool(
  hang: { x: number; y: number; z: number },
  aim: { x: number; y: number; z: number },
  beamDeg = 40,
) {
  const dx = aim.x - hang.x, dy = aim.y - hang.y, dz = aim.z - hang.z;
  if (!(dy < -1)) return null;
  const t = -hang.y / dy;
  if (!(t > 0)) return null;
  const x = hang.x + dx * t;
  const z = hang.z + dz * t;
  const dist = Math.hypot(dx, dy, dz) * t;
  const radius = Math.max(350, dist * Math.tan((beamDeg * Math.PI) / 360));
  return { x, z, radius };
}

export function patchFixtureFocus(plan: HangPlan, fixtureId: string, focus: FixtureFocus): HangPlan {
  return {
    fixtures: plan.fixtures.map(fixture => fixture.id === fixtureId
      ? { ...fixture, focus: { ...fixture.focus, ...focus } }
      : fixture),
  };
}

/** Rename a hang fixture (venue Bezeichnung). */
export function patchFixtureLabel(plan: HangPlan, fixtureId: string, label: string): HangPlan {
  const next = name.safeParse(label);
  if (!next.success) return plan;
  return {
    fixtures: plan.fixtures.map(fixture => fixture.id === fixtureId
      ? { ...fixture, label: next.data }
      : fixture),
  };
}

/** Suggest S1, S2, … for newly hung fixtures so the board is not all “Fresnel”. */
export function nextFixtureLabel(plan: HangPlan): string {
  const used = new Set(plan.fixtures.map(fixture => fixture.label));
  let n = plan.fixtures.length + 1;
  while (used.has(`S${n}`)) n += 1;
  return `S${n}`;
}

/** Change Gerätetyp on an existing hang; drop barn doors when the type cannot carry them. */
export function patchFixtureType(plan: HangPlan, fixtureId: string, typeId: BuiltInFixtureTypeId): HangPlan {
  return {
    fixtures: plan.fixtures.map(fixture => {
      if (fixture.id !== fixtureId || fixture.typeId === typeId) return fixture;
      const capable = builtInFixtureTypes[typeId].barnDoorsCapable;
      const oldDefault = builtInFixtureTypes[fixture.typeId].defaultBeam;
      const prior = fixture.focus;
      const beam = prior?.beam;
      const focus = prior ? {
        ...prior,
        beam: beam === undefined || beam === oldDefault ? undefined : beam,
        barnDoors: capable ? prior.barnDoors : undefined,
      } : undefined;
      return {
        ...fixture,
        typeId,
        barnDoorsAttached: capable ? fixture.barnDoorsAttached : false,
        focus,
      };
    }),
  };
}

/**
 * Look-owned levels only: intensity + colour.
 * Legacy pan/tilt/beam/barnDoors keys still parse (ignored at render) so old layouts load.
 */
export const lightLookFixtureStateSchema = z.strictObject({
  intensity: z.number().finite().min(0).max(200).default(100),
  color: color.default('#ffe0b3'),
  beam: z.number().finite().min(10).max(120).optional(),
  pan: z.number().finite().min(-180).max(180).optional(),
  tilt: z.number().finite().min(-90).max(90).optional(),
  barnDoors: barnDoorFlapsSchema.optional(),
});
export type LightLookFixtureState = z.infer<typeof lightLookFixtureStateSchema>;

export const lightLookSchema = z.strictObject({
  id: z.uuid(),
  name: name,
  fixtures: z.record(z.uuid(), lightLookFixtureStateSchema).default({}),
});
export type LightLook = z.infer<typeof lightLookSchema>;

export const lightLooksSchema = z.array(lightLookSchema).max(250)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Light look IDs must be unique');

export function newLightLook(id: string, name = 'Look 1'): LightLook {
  return { id, name, fixtures: {} };
}

/**
 * Legacy circular stand-in: average flap closure shrinks one cone.
 * The preview crops with {@link barnDoorCookieMask} instead, so each flap cuts its own edge.
 */
export function clippedBeamDegrees(beam: number, flaps?: BarnDoorFlaps): number {
  if (!flaps) return beam;
  const closure = (flaps.top + flaps.bottom + flaps.stageLeft + flaps.stageRight) / 4 / 90;
  return Math.max(8, beam * (1 - closure * 0.85));
}

/** Width of the soft barn-door edge, in units of the unclipped beam radius (1 = cone edge). */
const BARN_DOOR_EDGE_SOFTNESS = 0.08;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const span = edge1 - edge0;
  if (span === 0) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / span));
  return t * t * (3 - 2 * t);
}

/**
 * Barn-door window in the beam cross-section, −1…+1.
 * −x is stage left, −y is the top flap (upstage when the fixture looks toward the audience).
 * 0° leaves that edge on the cone; 90° brings it to the axis.
 */
export function barnDoorWindow(flaps: BarnDoorFlaps) {
  return {
    stageLeft: -1 + flaps.stageLeft / 90,
    stageRight: 1 - flaps.stageRight / 90,
    top: -1 + flaps.top / 90,
    bottom: 1 - flaps.bottom / 90,
  };
}

/** 0 = dark, 1 = full beam. Disk of the unclipped cone, cut by a soft rectangle. */
export function barnDoorCoverage(nx: number, ny: number, flaps: BarnDoorFlaps = openBarnDoors): number {
  const window = barnDoorWindow(flaps);
  const soft = BARN_DOOR_EDGE_SOFTNESS;
  const horizontal = Math.min(
    smoothstep(window.stageLeft - soft, window.stageLeft + soft, nx),
    smoothstep(window.stageRight + soft, window.stageRight - soft, nx),
  );
  const vertical = Math.min(
    smoothstep(window.top - soft, window.top + soft, ny),
    smoothstep(window.bottom + soft, window.bottom - soft, ny),
  );
  const disk = smoothstep(1 + soft, 1 - soft, Math.hypot(nx, ny));
  return Math.min(disk, horizontal, vertical);
}

/**
 * Greyscale SpotLight cookie. Row 0 is the top flap; column 0 is stage left.
 * Corners stay dark (the cone is a disk). 255 is lit.
 */
export function barnDoorCookieMask(flaps: BarnDoorFlaps = openBarnDoors, size = 64): { size: number; pixels: Uint8ClampedArray } {
  const pixels = new Uint8ClampedArray(size * size);
  for (let row = 0; row < size; row++) {
    const ny = ((row + 0.5) / size) * 2 - 1;
    for (let col = 0; col < size; col++) {
      const nx = ((col + 0.5) / size) * 2 - 1;
      pixels[row * size + col] = Math.round(barnDoorCoverage(nx, ny, flaps) * 255);
    }
  }
  return { size, pixels };
}

/** Cookie for a hung fixture. Unmounted barn doors leave the circular cone unmasked. */
export function barnDoorSpotCookie(attached: boolean, flaps?: BarnDoorFlaps, size = 64) {
  if (!attached) return null;
  return barnDoorCookieMask(flaps ?? openBarnDoors, size);
}

type BeamPoint = { x: number; y: number };

function clipBeamPolygon(
  polygon: BeamPoint[],
  inside: (point: BeamPoint) => boolean,
  edge: (a: BeamPoint, b: BeamPoint) => BeamPoint,
): BeamPoint[] {
  if (!polygon.length) return [];
  const next: BeamPoint[] = [];
  let previous = polygon[polygon.length - 1]!;
  let previousInside = inside(previous);
  for (const current of polygon) {
    const currentInside = inside(current);
    if (currentInside !== previousInside) next.push(edge(previous, current));
    if (currentInside) next.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return next;
}

/**
 * Floor hit of the barn-door crop (plan millimetres). Same window as the cookie:
 * top cuts upstage of the aim, stage left cuts −X when the beam points at the audience.
 * Omitted flaps leave the unclipped disk. Null when the beam misses the floor.
 */
export function barnDoorFloorOutline(
  hang: { x: number; y: number; z: number },
  aim: { x: number; y: number; z: number },
  beamDeg = 40,
  flaps?: BarnDoorFlaps,
  segments = 64,
): { x: number; z: number }[] | null {
  const pool = fixtureFloorPool(hang, aim, beamDeg);
  if (!pool) return null;
  const window = barnDoorWindow(flaps ?? openBarnDoors);
  let polygon: BeamPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    polygon.push({ x: Math.cos(angle), y: Math.sin(angle) });
  }
  const slack = 1e-5;
  const cuts: { axis: 'x' | 'y'; limit: number; inside: (point: BeamPoint) => boolean }[] = [
    { axis: 'x', limit: window.stageLeft, inside: point => point.x >= window.stageLeft - slack },
    { axis: 'x', limit: window.stageRight, inside: point => point.x <= window.stageRight + slack },
    { axis: 'y', limit: window.top, inside: point => point.y >= window.top - slack },
    { axis: 'y', limit: window.bottom, inside: point => point.y <= window.bottom + slack },
  ];
  for (const cut of cuts) {
    polygon = clipBeamPolygon(polygon, cut.inside, (a, b) => {
      const delta = b[cut.axis] - a[cut.axis];
      const t = delta === 0 ? 0 : (cut.limit - a[cut.axis]) / delta;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    });
  }
  if (polygon.length < 3) return null;
  let forwardX = aim.x - hang.x;
  let forwardZ = aim.z - hang.z;
  const horizontal = Math.hypot(forwardX, forwardZ);
  if (horizontal < 1) {
    forwardX = 0;
    forwardZ = -1;
  } else {
    forwardX /= horizontal;
    forwardZ /= horizontal;
  }
  const rightX = -forwardZ;
  const rightZ = forwardX;
  return polygon.map(point => ({
    x: pool.x + (point.x * rightX + point.y * forwardX) * pool.radius,
    z: pool.z + (point.x * rightZ + point.y * forwardZ) * pool.radius,
  }));
}

/**
 * Aim point on the floor plane (Y = floorY) from a hang position.
 * Tilt 0 = straight down; positive tilt toward the audience (−Z).
 * Positive pan = stage left (−X). Units must match hang/floor (mm or m).
 */
export function fixtureAimPoint(
  hang: { x: number; y: number; z: number },
  panDeg = 0,
  tiltDeg = 0,
  floorY = 0,
): { x: number; y: number; z: number } {
  const drop = Math.max(hang.y - floorY, hang.y * 0.05, 1e-3);
  const tilt = Math.max(-89, Math.min(89, tiltDeg)) * Math.PI / 180;
  const pan = panDeg * Math.PI / 180;
  const throwDist = drop * Math.tan(tilt);
  return {
    x: hang.x - Math.sin(pan) * throwDist,
    y: floorY,
    z: hang.z - Math.cos(pan) * throwDist,
  };
}

/**
 * Pan/tilt so the beam hits `target` on the floor (Capture focus-on-point).
 * Matches fixtureAimPoint conventions.
 */
export function focusTowardPoint(
  hang: { x: number; y: number; z: number },
  target: { x: number; y?: number; z: number },
): { pan: number; tilt: number } {
  const floorY = target.y ?? 0;
  const dx = target.x - hang.x;
  const dz = target.z - hang.z;
  const drop = Math.max(hang.y - floorY, hang.y * 0.05, 1e-3);
  const horiz = Math.hypot(dx, dz);
  const tilt = Math.max(-89, Math.min(89, Math.atan2(horiz, drop) * 180 / Math.PI));
  // fixtureAimPoint: Δx = −sin(pan)·throw, Δz = −cos(pan)·throw → pan = atan2(−Δx, −Δz)
  const pan = horiz < 1e-6 ? 0 : Math.atan2(-dx, -dz) * 180 / Math.PI;
  return { pan, tilt };
}

/** Resolved pan/tilt/beam/flaps for rendering: explicit hang focus, else aim at stage centre. */
export function resolveFixtureAim(
  hang: { x: number; y: number; z: number },
  focus: FixtureFocus | undefined,
  stageCentre: { x: number; z: number },
  floorY = 0,
): { pan: number; tilt: number; aim: { x: number; y: number; z: number } } {
  const hasPan = focus?.pan != null;
  const hasTilt = focus?.tilt != null;
  const aimed = focusTowardPoint(hang, { x: stageCentre.x, y: floorY, z: stageCentre.z });
  const pan = hasPan ? focus!.pan! : aimed.pan;
  const tilt = hasTilt ? focus!.tilt! : aimed.tilt;
  return { pan, tilt, aim: fixtureAimPoint(hang, pan, tilt, floorY) };
}

/**
 * Plan millimetres → Raumsicht metres with the audience-left X mirror
 * (`position=[W,0,0] scale=[-1,1,1]`). Fixture meshes live inside that mirror;
 * theatre lights outside it must use the same mapping.
 */
export function planMmToViewMetres(
  xMm: number, yMm: number, zMm: number, venueWidthMm: number, units = 1,
): { x: number; y: number; z: number } {
  return {
    x: (venueWidthMm - xMm) / 1000 * units,
    y: yMm / 1000 * units,
    z: zMm / 1000 * units,
  };
}
