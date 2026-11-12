import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { partLibraryJsonSchema } from '../src/shared/parts/index.js';

const FILE = fileURLToPath(new URL('../docs/schemas/part-library.schema.json', import.meta.url));
const expected = () => `${JSON.stringify(partLibraryJsonSchema(), null, 2)}\n`;

test('docs/schemas/part-library.schema.json is the schema the server serves (UPDATE_SCHEMA=1 rewrites it)', () => {
  if (process.env.UPDATE_SCHEMA === '1') {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, expected());
  }
  assert.equal(readFileSync(FILE, 'utf8'), expected(), 'run `UPDATE_SCHEMA=1 npm test` after changing the part library schema');
  const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;
  assert.equal(parsed.title, 'StageHarbour Bauteilbibliothek');
  assert.equal(parsed.$schema, 'https://json-schema.org/draft/2020-12/schema');
});
