import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { newLightingFixture } from '../src/shared/hangPlan.js';
import { venueGeometrySchema } from '../src/shared/layout.js';

test('venue round-trips hang points and hang plan fixtures', () => {
  const trussId = randomUUID();
  const hangId = randomUUID();
  const fixtureId = randomUUID();
  const parsed = venueGeometrySchema.parse({
    schemaVersion: 1, width: 10000, depth: 8000,
    trusses: [{
      id: trussId, label: 'Licht', x: 5000, y: 4000, rotation: 0,
      length: 6000, sectionWidth: 400, bottomHeight: 3500, thickness: 300,
      hangPoints: [{ id: hangId, offsetMm: -1000 }],
    }],
    hangPlan: {
      fixtures: [newLightingFixture(fixtureId, trussId, hangId, 'fresnel', {
        label: 'F1', barnDoorsAttached: true,
      })],
    },
  });
  assert.equal(parsed.trusses?.[0]!.hangPoints[0]!.offsetMm, -1000);
  assert.equal(parsed.hangPlan?.fixtures[0]!.label, 'F1');
  assert.equal(parsed.hangPlan?.fixtures[0]!.barnDoorsAttached, true);
});
