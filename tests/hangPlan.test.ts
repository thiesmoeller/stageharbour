import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  barnDoorCookieMask, barnDoorFloorOutline, barnDoorSpotCookie, clippedBeamDegrees, defaultFocusTowardCentre, emptyHangPlan, fixtureAimPoint, fixtureFloorPool, focusTowardPoint, hangPlanFitsTrusses, hangPlanSchema, lightLookSchema,
  newLightLook, newLightingFixture, nextFixtureLabel, openBarnDoors, patchFixtureLabel, patchFixtureType, planMmToViewMetres, resolveFixtureAim,
} from '../src/shared/hangPlan.js';
import { layoutSchema, venueGeometrySchema } from '../src/shared/layout.js';
import { defaultPlanDisplay } from '../src/shared/planDisplay.js';

test('hang plan accepts one fresnel with barn doors per hang point', () => {
  const trussId = randomUUID();
  const hangId = randomUUID();
  const plan = hangPlanSchema.parse({
    fixtures: [newLightingFixture(randomUUID(), trussId, hangId, 'fresnel', { barnDoorsAttached: true })],
  });
  assert.equal(plan.fixtures[0]!.barnDoorsAttached, true);
  assert.equal(hangPlanFitsTrusses(plan, [{ id: trussId, hangPoints: [{ id: hangId }] }]), true);
  assert.equal(hangPlanFitsTrusses(plan, [{ id: trussId, hangPoints: [] }]), false);
});

test('wash cannot attach barn doors; two fixtures cannot share a hang point', () => {
  const trussId = randomUUID();
  const hangId = randomUUID();
  assert.throws(() => hangPlanSchema.parse({
    fixtures: [newLightingFixture(randomUUID(), trussId, hangId, 'wash', { barnDoorsAttached: true })],
  }));
  assert.throws(() => hangPlanSchema.parse({
    fixtures: [
      newLightingFixture(randomUUID(), trussId, hangId, 'flood'),
      newLightingFixture(randomUUID(), trussId, hangId, 'fresnel'),
    ],
  }));
});

test('venue geometry rejects hang plan that points at missing hang points', () => {
  const trussId = randomUUID();
  const hangId = randomUUID();
  const bad = venueGeometrySchema.safeParse({
    schemaVersion: 1, width: 8000, depth: 6000,
    trusses: [{
      id: trussId, label: 'T1', x: 0, y: 0, rotation: 0, length: 6000, sectionWidth: 400,
      bottomHeight: 3500, thickness: 300, hangPoints: [],
    }],
    hangPlan: { fixtures: [newLightingFixture(randomUUID(), trussId, hangId, 'flood')] },
  });
  assert.equal(bad.success, false);
});

test('light look and active id round-trip on layout', () => {
  const look = newLightLook(randomUUID(), 'Kneipe warm');
  look.fixtures[randomUUID()] = { intensity: 80, color: '#ffcc88', beam: 45, barnDoors: openBarnDoors };
  const layout = layoutSchema.parse({
    schemaVersion: 2, objects: [], joints: [],
    lightLooks: [look], activeLightLookId: look.id,
  });
  assert.equal(layout.lightLooks?.[0]!.name, 'Kneipe warm');
  assert.equal(clippedBeamDegrees(50, { top: 90, bottom: 90, stageLeft: 90, stageRight: 90 }) < 20, true);
  assert.deepEqual(emptyHangPlan, { fixtures: [] });
  assert.equal(lightLookSchema.parse(look).id, look.id);
});

test('plan display defaults include truss and lighting fixture toggles', () => {
  assert.deepEqual(defaultPlanDisplay, {
    showUnderlay: true, showObjectNames: true, showDimensions: true, showTexts: true,
    showTrusses: true, showLightingFixtures: true,
  });
});

test('fixtureAimPoint tilts toward audience and pans stage-left', () => {
  const hang = { x: 4000, y: 3500, z: 3000 };
  const down = fixtureAimPoint(hang, 0, 0, 0);
  assert.equal(down.x, 4000);
  assert.equal(down.z, 3000);
  assert.equal(down.y, 0);
  const towardAudience = fixtureAimPoint(hang, 0, 45, 0);
  assert.ok(towardAudience.z < 3000);
  assert.ok(Math.abs(towardAudience.x - 4000) < 1);
  const stageLeft = fixtureAimPoint(hang, 90, 45, 0);
  assert.ok(stageLeft.x < 4000);
});

test('focusTowardPoint aims downstage hang toward stage centre (not reverse)', () => {
  // Hang downstage of centre (small z) → aim should increase z (upstage into the playing area).
  const hang = { x: 4000, y: 3500, z: 1000 };
  const centre = { x: 4000, z: 3000 };
  const focus = focusTowardPoint(hang, centre);
  const aim = fixtureAimPoint(hang, focus.pan, focus.tilt, 0);
  assert.ok(aim.z > hang.z, `expected aim upstage, got z=${aim.z}`);
  const resolved = resolveFixtureAim(hang, undefined, centre, 0);
  assert.ok(resolved.aim.z > hang.z);
});

test('defaultFocusTowardCentre matches venue midpoint aim', () => {
  const hang = { x: 1000, y: 3500, z: 500 };
  const focus = defaultFocusTowardCentre(hang, 8000, 6000);
  assert.deepEqual(focus, focusTowardPoint(hang, { x: 4000, z: 3000 }));
});

test('fixtureFloorPool hits stage floor under down-aim', () => {
  const hang = { x: 4000, y: 4000, z: 1000 };
  const aim = { x: 4000, y: 0, z: 3000 };
  const pool = fixtureFloorPool(hang, aim, 40);
  assert.ok(pool);
  assert.equal(pool!.x, 4000);
  assert.equal(pool!.z, 3000);
  assert.ok(pool!.radius >= 350);
  assert.equal(fixtureFloorPool(hang, { x: 4000, y: 5000, z: 3000 }), null);
});

test('focusTowardPoint aims at elevated wall/platform targets', () => {
  const hang = { x: 4000, y: 4000, z: 1000 };
  const wall = { x: 2000, y: 1800, z: 3000 };
  const focus = focusTowardPoint(hang, wall);
  assert.ok(focus.tilt > 0);
  assert.ok(focus.pan !== 0);
  const aim = fixtureAimPoint(hang, focus.pan, focus.tilt, wall.y);
  assert.ok(Math.abs(aim.x - wall.x) < 80, `x ${aim.x} vs ${wall.x}`);
  assert.ok(Math.abs(aim.z - wall.z) < 80, `z ${aim.z} vs ${wall.z}`);
});

test('hang fixture focus stores pan/tilt; looks keep intensity only', () => {
  const trussId = randomUUID();
  const hangId = randomUUID();
  const fixture = newLightingFixture(randomUUID(), trussId, hangId, 'fresnel', {
    focus: { pan: 10, tilt: 25, beam: 40 },
  });
  const plan = hangPlanSchema.parse({ fixtures: [fixture] });
  assert.equal(plan.fixtures[0]!.focus?.tilt, 25);
  const look = newLightLook(randomUUID(), 'Abend');
  look.fixtures[fixture.id] = { intensity: 40, color: '#ffaa66' };
  assert.equal(lightLookSchema.parse(look).fixtures[fixture.id]!.intensity, 40);
});

test('patchFixtureType switches Gerätetyp and clears barn doors on wash', () => {
  const trussId = randomUUID();
  const hangId = randomUUID();
  const id = randomUUID();
  const plan = hangPlanSchema.parse({
    fixtures: [newLightingFixture(id, trussId, hangId, 'fresnel', {
      barnDoorsAttached: true,
      focus: { pan: 5, tilt: 20, beam: 50, barnDoors: openBarnDoors },
    })],
  });
  const wash = patchFixtureType(plan, id, 'wash');
  assert.equal(wash.fixtures[0]!.typeId, 'wash');
  assert.equal(wash.fixtures[0]!.barnDoorsAttached, false);
  assert.equal(wash.fixtures[0]!.focus?.barnDoors, undefined);
  assert.equal(wash.fixtures[0]!.focus?.beam, undefined);
  assert.equal(wash.fixtures[0]!.focus?.pan, 5);
  const flood = patchFixtureType(wash, id, 'flood');
  assert.equal(flood.fixtures[0]!.typeId, 'flood');
  assert.equal(flood.fixtures[0]!.barnDoorsAttached, false);
});

function maskAt(mask: { size: number; pixels: Uint8ClampedArray }, nx: number, ny: number) {
  const col = Math.min(mask.size - 1, Math.max(0, Math.round(((nx + 1) * mask.size) / 2 - 0.5)));
  const row = Math.min(mask.size - 1, Math.max(0, Math.round(((ny + 1) * mask.size) / 2 - 0.5)));
  return mask.pixels[row * mask.size + col]!;
}

test('barn door cookie is a full disk, one closed flap darkens that edge, and unmounted doors have no map', () => {
  const open = barnDoorCookieMask(openBarnDoors, 32);
  assert.ok(maskAt(open, 0, 0) > 240);
  assert.ok(maskAt(open, 0, -0.7) > 200);
  assert.ok(maskAt(open, 0, 0.7) > 200);
  assert.ok(maskAt(open, -0.7, 0) > 200);
  assert.ok(maskAt(open, 0.7, 0) > 200);
  assert.ok(maskAt(open, 0.92, 0.92) < 30);

  const topClosed = barnDoorCookieMask({ ...openBarnDoors, top: 90 }, 32);
  assert.ok(maskAt(topClosed, 0, -0.7) < 40);
  assert.ok(maskAt(topClosed, 0, -0.7) < maskAt(open, 0, -0.7));
  assert.ok(maskAt(topClosed, 0, 0.7) > 200);

  const stageLeftClosed = barnDoorCookieMask({ ...openBarnDoors, stageLeft: 90 }, 32);
  assert.ok(maskAt(stageLeftClosed, -0.7, 0) < 40);
  assert.ok(maskAt(stageLeftClosed, 0.7, 0) > 200);

  const bottomClosed = barnDoorCookieMask({ ...openBarnDoors, bottom: 90 }, 32);
  assert.ok(maskAt(bottomClosed, 0, 0.7) < 40);
  assert.ok(maskAt(bottomClosed, 0, -0.7) > 200);

  const stageRightClosed = barnDoorCookieMask({ ...openBarnDoors, stageRight: 90 }, 32);
  assert.ok(maskAt(stageRightClosed, 0.7, 0) < 40);
  assert.ok(maskAt(stageRightClosed, -0.7, 0) > 200);

  assert.equal(barnDoorSpotCookie(false, { ...openBarnDoors, top: 90 }), null);
  const mounted = barnDoorSpotCookie(true);
  assert.ok(mounted);
  assert.equal(mounted.pixels.length, mounted.size * mounted.size);
  assert.ok(maskAt(mounted, 0, 0) > 240);
  assert.ok(maskAt(mounted, 0.92, 0.92) < 30);
});

test('barn door floor outline cuts the closed flap and keeps an open disk', () => {
  const hang = { x: 4000, y: 4000, z: 3000 };
  const aim = { x: 4000, y: 0, z: 3000 };
  const open = barnDoorFloorOutline(hang, aim, 40, openBarnDoors);
  assert.ok(open);
  const radii = open.map(point => Math.hypot(point.x - hang.x, point.z - hang.z));
  const radius = Math.max(...radii);
  assert.ok(radius - Math.min(...radii) < radius * 0.02);

  const topClosed = barnDoorFloorOutline(hang, aim, 40, { ...openBarnDoors, top: 90 });
  assert.ok(topClosed);
  assert.ok(Math.max(...topClosed.map(point => point.z)) < Math.max(...open.map(point => point.z)) - radius * 0.4);
  assert.ok(Math.min(...topClosed.map(point => point.z)) < hang.z - radius * 0.5);

  const stageLeftClosed = barnDoorFloorOutline(hang, aim, 40, { ...openBarnDoors, stageLeft: 90 });
  assert.ok(stageLeftClosed);
  assert.ok(Math.min(...stageLeftClosed.map(point => point.x)) > Math.min(...open.map(point => point.x)) + radius * 0.4);

  assert.equal(barnDoorFloorOutline(hang, { x: 4000, y: 5000, z: 3000 }, 40, openBarnDoors), null);
});

test('patchFixtureLabel renames hang fixtures; nextFixtureLabel suggests S1…', () => {
  const trussId = randomUUID();
  const hangId = randomUUID();
  const id = randomUUID();
  const plan = hangPlanSchema.parse({
    fixtures: [newLightingFixture(id, trussId, hangId, 'fresnel')],
  });
  assert.equal(nextFixtureLabel(emptyHangPlan), 'S1');
  assert.equal(nextFixtureLabel(plan), 'S2');
  const renamed = patchFixtureLabel(plan, id, '  Front links  ');
  assert.equal(renamed.fixtures[0]!.label, 'Front links');
  assert.equal(patchFixtureLabel(plan, id, '   ').fixtures[0]!.label, plan.fixtures[0]!.label);
});
