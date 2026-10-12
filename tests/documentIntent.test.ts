import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  cableScheduleRows, documentReadiness, layersForPurpose, sectionsForPurpose,
} from '../src/shared/exportDocument.js';
import {
  cableRunSchema, newCableRun, polylineLengthMm, requiredCableLengthMm,
} from '../src/shared/infrastructure.js';

test('recipient presets expose job language and hide technical layers from performer handouts', () => {
  assert.deepEqual(sectionsForPurpose('performers'), ['cover', 'overviewPlan', 'roomViews']);
  assert.equal(layersForPurpose('performers').dimensions, false);
  assert.equal(layersForPurpose('performers').cables, false);
  assert.equal(sectionsForPurpose('technical').includes('cableSchedule'), true);
  assert.equal(layersForPurpose('technical').cables, true);
});

test('technical readiness names missing actual cable runs', () => {
  const missing = documentReadiness({
    purpose: 'technical', sections: sectionsForPurpose('technical'),
  }, [{ layout: {} }]);
  assert.deepEqual(missing, [{
    code: 'no-cable-runs', message: 'Noch keine tatsächlichen Kabelwege geplant.', action: 'cables',
  }]);
  assert.deepEqual(documentReadiness({
    purpose: 'technical', sections: sectionsForPurpose('technical'),
  }, [{ layout: { cableRuns: [{}] } }]), []);
});

test('actual cable runs validate and compute route plus slack independently of corridors', () => {
  const run = {
    ...newCableRun(randomUUID(), { x: 0, y: 0 }, { x: 3000, y: 4000 }),
    quantity: 2,
    slackMm: 1500,
  };
  assert.equal(polylineLengthMm(run.path), 5000);
  assert.equal(requiredCableLengthMm(run), 6500);
  assert.equal(cableRunSchema.parse(run).start.label, 'Technikstand');
  assert.equal(requiredCableLengthMm(run) * run.quantity, 13000);
  const grouped = cableScheduleRows([run, { ...run, id: randomUUID(), quantity: 1 }]);
  assert.deepEqual(grouped, [['Strom · Strom', 'Technikstand → Bühne', '3', '6.5 m (1.5 m Zugabe)']]);
});
