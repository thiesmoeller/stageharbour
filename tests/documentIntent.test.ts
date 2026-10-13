import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  cableScheduleRows, documentReadiness, layersForPurpose, sectionsForPurpose,
} from '../src/shared/exportDocument.js';
import {
  cableRunSchema, insertCableRunVertex, nearestCableRunInsert, nearestCableRunSegment, newCableRun,
  polylineLengthMm, removeCableRunVertex, requiredCableLengthMm, setCableRunVertex,
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
    ...newCableRun(randomUUID(), [{ x: 0, y: 0 }, { x: 3000, y: 4000 }]),
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

test('cable run polylines move and insert vertices while keeping endpoints aligned', () => {
  let run = newCableRun(randomUUID(), [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }]);
  assert.equal(polylineLengthMm(run.path), 7000);
  run = setCableRunVertex(run, 1, { x: 2000, y: 1000 });
  assert.deepEqual(run.path[1], { x: 2000, y: 1000 });
  assert.equal(run.start.x, 0);
  assert.equal(run.end.y, 3000);
  run = insertCableRunVertex(run, 0, { x: 1000, y: 0 });
  assert.equal(run.path.length, 4);
  assert.equal(nearestCableRunSegment(run, { x: 500, y: 40 }, 200), 0);
  assert.deepEqual(nearestCableRunInsert(run, { x: 500, y: 40 }, 200), { afterIndex: 0, point: { x: 500, y: 0 } });
  run = removeCableRunVertex(run, 1);
  assert.equal(run.path.length, 3);
});

test('cable vertex insert/remove refuse endpoints, coincident points, and out-of-reach clicks', () => {
  const two = newCableRun(randomUUID(), [{ x: 0, y: 0 }, { x: 2000, y: 0 }]);
  assert.equal(removeCableRunVertex(two, 0), two);
  assert.equal(removeCableRunVertex(two, 1), two);
  assert.equal(insertCableRunVertex(two, 0, { x: 0, y: 0 }), two);
  assert.equal(insertCableRunVertex(two, 0, { x: 2000, y: 0 }), two);
  assert.equal(insertCableRunVertex(two, -1, { x: 1000, y: 0 }), two);
  assert.equal(nearestCableRunInsert(two, { x: 1000, y: 500 }, 100), undefined);
  assert.deepEqual(nearestCableRunInsert(two, { x: 1000, y: 40 }, 100), { afterIndex: 0, point: { x: 1000, y: 0 } });

  const three = newCableRun(randomUUID(), [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }]);
  assert.equal(removeCableRunVertex(three, 0), three);
  assert.equal(removeCableRunVertex(three, 2), three);
  assert.deepEqual(removeCableRunVertex(three, 1).path, [{ x: 0, y: 0 }, { x: 2000, y: 0 }]);
  const movedEnd = setCableRunVertex(three, 2, { x: 2500, y: 500 });
  assert.equal(movedEnd.end.x, 2500);
  assert.equal(movedEnd.end.y, 500);
  assert.equal(movedEnd.start.x, 0);
});
