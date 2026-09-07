import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freezeSnapshot } from '../src/shared/export.js';
import { newWall } from '../src/shared/layout.js';
import { renderConstructionPlan } from '../src/server/exports/pdf.js';
import { renderOffThread } from '../src/server/exports/render.js';

function pathLengthsMm(pdf: Buffer) {
  const ptPerMm = 72 / 25.4;
  const lengths: number[] = [];
  for (const block of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const content = block[1] ?? '';
    let x = 0, y = 0;
    for (const token of content.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(m|l)/g)) {
      const nx = Number(token[1]), ny = Number(token[2]);
      if (token[3] === 'l') lengths.push(Math.hypot(nx - x, ny - y) / ptPerMm);
      x = nx; y = ny;
    }
  }
  return lengths;
}
function shownText(pdf: Buffer) {
  return [...pdf.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
}
function sampleSnapshot() {
  const wall = newWall(randomUUID(), 2000, 3000);
  return freezeSnapshot({
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    layout: { schemaVersion: 1, walls: [wall] },
  }, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
}

test('a 1200 mm wall at 1:50 is 24 mm on the A4 page', async () => {
  const pdf = await renderConstructionPlan(sampleSnapshot());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const text = shownText(pdf);
  assert(text.includes('Fassung Probe'), text);
  assert(text.includes('07.09.2026'));
  assert(text.includes('Maßstab 1:50'));
  assert(text.includes('Publikum'));
  assert(pathLengthsMm(pdf).some(length => Math.abs(length - 24) < 0.05), pathLengthsMm(pdf).slice(0, 12).join(','));
});

test('construction plan PDF generation runs off the API thread', async () => {
  const pdf = await renderOffThread(sampleSnapshot());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert(pathLengthsMm(pdf).some(length => Math.abs(length - 24) < 0.05));
});
