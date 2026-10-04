import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  clippedBeamDegrees, defaultFocusTowardCentre, emptyHangPlan, fixtureAimPoint, fixtureFloorPool, focusTowardPoint, hangPlanFitsTrusses, hangPlanSchema, lightLookSchema,
  newLightLook, newLightingFixture, openBarnDoors, planMmToViewMetres, resolveFixtureAim,
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
    schemaVersion: 1, walls: [], braces: [],
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

test('planMmToViewMetres mirrors X to match Raumsicht audience-left flip', () => {
  const width = 10000;
  // Plan-left (x=1000) must land on the right in view metres after mirror.
  const left = planMmToViewMetres(1000, 3500, 2000, width, 1);
  assert.equal(left.x, 9);
  assert.equal(left.y, 3.5);
  assert.equal(left.z, 2);
  const centre = planMmToViewMetres(5000, 0, 3000, width, 1);
  assert.equal(centre.x, 5);
});
