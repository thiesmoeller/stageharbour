import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { startCatalogApp, type CatalogApp } from '../helpers/catalogApp.js';
import { PARTS_TRACE_FILE, normaliseTrace, runPartsScenario } from '../helpers/partsScenario.js';

let t: CatalogApp;
before(async () => { t = await startCatalogApp(); });
after(async () => { await t?.close(); });

test('the server answers the catalog scenario as the committed trace says (the same trace local mode must produce)', async () => {
  const trace = normaliseTrace(await runPartsScenario({
    workspaceId: t.workspaceId, send: (role, method, path, payload) => t.send(role, method, path, payload),
  }), t.workspaceId);
  if (process.env.UPDATE_PARTS_TRACE === '1') {
    writeFileSync(PARTS_TRACE_FILE, `${JSON.stringify(trace, null, 2)}\n`);
    return;
  }
  assert.deepEqual(trace, JSON.parse(readFileSync(PARTS_TRACE_FILE, 'utf8')));
});
