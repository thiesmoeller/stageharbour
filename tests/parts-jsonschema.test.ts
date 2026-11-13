import assert from 'node:assert/strict';
import test from 'node:test';
import { PARAMETER_SCOPES, PARAMETER_TYPES, partLibraryJsonSchema, partLibrarySchema, STARTER_LIBRARY } from '../src/shared/parts/index.js';
import { FIXTURE_MATERIALS, FIXTURE_PARTS } from './helpers/partsFixtures.js';

type JsonSchema = Record<string, unknown>;
type SchemaError = { path: string; message: string };

const ANNOTATIONS = new Set(['$schema', '$defs', 'title', 'description', 'default', 'format']);

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural validator for the subset of draft 2020-12 that `z.toJSONSchema` emits for the
 * library. An unknown keyword throws, so the test cannot pass by ignoring part of the schema.
 */
function validateJson(root: JsonSchema, schema: unknown, value: unknown, path = ''): SchemaError[] {
  if (schema === true) return [];
  if (schema === false) return [{ path, message: 'not allowed' }];
  assert.ok(isRecord(schema), `schema at ${path} is an object`);
  const errors: SchemaError[] = [];
  const fail = (message: string) => errors.push({ path, message });
  const check = (sub: unknown, item: unknown, at = path) => validateJson(root, sub, item, at);

  for (const [keyword, rule] of Object.entries(schema)) {
    if (ANNOTATIONS.has(keyword)) continue;
    switch (keyword) {
      case '$ref': {
        const match = /^#\/\$defs\/(.+)$/.exec(String(rule));
        assert.ok(match, `local reference ${String(rule)}`);
        const target = (root.$defs as Record<string, unknown>)[match[1]!];
        assert.ok(target !== undefined, `reference ${String(rule)} resolves`);
        errors.push(...check(target, value));
        break;
      }
      case 'type': {
        const actual = jsonType(value);
        if (!(actual === rule || (rule === 'number' && actual === 'integer'))) fail(`expected ${String(rule)}, got ${actual}`);
        break;
      }
      case 'const':
        if (value !== rule) fail(`expected ${JSON.stringify(rule)}`);
        break;
      case 'enum':
        if (!(rule as unknown[]).includes(value)) fail(`expected one of ${JSON.stringify(rule)}`);
        break;
      case 'anyOf':
        if (!(rule as unknown[]).some(option => check(option, value).length === 0)) fail('matches no alternative');
        break;
      case 'oneOf': {
        const matches = (rule as unknown[]).filter(option => check(option, value).length === 0).length;
        if (matches !== 1) fail(`matches ${matches} alternatives instead of one`);
        break;
      }
      case 'minimum':
        if (typeof value === 'number' && value < (rule as number)) fail(`below ${String(rule)}`);
        break;
      case 'maximum':
        if (typeof value === 'number' && value > (rule as number)) fail(`above ${String(rule)}`);
        break;
      case 'exclusiveMinimum':
        if (typeof value === 'number' && value <= (rule as number)) fail(`not above ${String(rule)}`);
        break;
      case 'minLength':
        if (typeof value === 'string' && value.length < (rule as number)) fail('too short');
        break;
      case 'maxLength':
        if (typeof value === 'string' && value.length > (rule as number)) fail('too long');
        break;
      case 'pattern':
        if (typeof value === 'string' && !new RegExp(rule as string, 'u').test(value)) fail(`does not match ${String(rule)}`);
        break;
      case 'minItems':
        if (Array.isArray(value) && value.length < (rule as number)) fail('too few items');
        break;
      case 'maxItems':
        if (Array.isArray(value) && value.length > (rule as number)) fail('too many items');
        break;
      case 'prefixItems':
        if (Array.isArray(value)) {
          (rule as unknown[]).forEach((sub, index) => {
            if (index < value.length) errors.push(...check(sub, value[index], `${path}/${index}`));
          });
        }
        break;
      case 'items':
        if (Array.isArray(value)) {
          const start = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
          value.slice(start).forEach((item, index) => errors.push(...check(rule, item, `${path}/${start + index}`)));
        }
        break;
      case 'required':
        if (isRecord(value)) {
          for (const name of rule as string[]) if (!(name in value)) errors.push({ path: `${path}/${name}`, message: 'missing' });
        }
        break;
      case 'properties':
        if (isRecord(value)) {
          for (const [name, sub] of Object.entries(rule as Record<string, unknown>)) {
            if (name in value) errors.push(...check(sub, value[name], `${path}/${name}`));
          }
        }
        break;
      case 'propertyNames':
        if (isRecord(value)) {
          for (const name of Object.keys(value)) errors.push(...check(rule, name, `${path}/${name}`));
        }
        break;
      case 'additionalProperties':
        if (isRecord(value)) {
          const known = isRecord(schema.properties) ? schema.properties : {};
          for (const [name, item] of Object.entries(value)) {
            if (!(name in known)) errors.push(...check(rule, item, `${path}/${name}`));
          }
        }
        break;
      default:
        assert.fail(`the test validator does not know the keyword "${keyword}" at ${path || '/'}`);
    }
  }
  return errors;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('partLibraryJsonSchema is a self-contained draft 2020-12 schema', () => {
  const schema = partLibraryJsonSchema();
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.title, 'StageHarbour Bauteilbibliothek');
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['schemaVersion', 'materials', 'parts']);
  assert.deepEqual(Object.keys(schema.properties as object), ['schemaVersion', 'materials', 'parts']);

  const text = JSON.stringify(schema);
  assert.deepEqual(JSON.parse(text), schema, 'plain JSON, nothing lost on the wire');
  const defs = schema.$defs as Record<string, unknown>;
  const references = [...text.matchAll(/"\$ref":"([^"]+)"/g)].map(match => match[1]!);
  assert.ok(references.length > 10);
  for (const reference of references) {
    assert.match(reference, /^#\/\$defs\//);
    assert.ok(reference.slice('#/$defs/'.length) in defs, `${reference} resolves`);
  }
  for (const word of ['box', 'beam', 'sheet', 'rect', 'arch', 'polygon', ...PARAMETER_SCOPES, ...PARAMETER_TYPES, 'profile', 'hardware']) {
    assert.ok(text.includes(`"${word}"`), `the schema names "${word}"`);
  }
});

test('the JSON Schema accepts the starter library and the test fixtures', () => {
  const schema = partLibraryJsonSchema();
  assert.deepEqual(validateJson(schema, schema, clone(STARTER_LIBRARY)), []);
  const fixtures = { schemaVersion: STARTER_LIBRARY.schemaVersion, materials: FIXTURE_MATERIALS, parts: FIXTURE_PARTS };
  assert.equal(partLibrarySchema.safeParse(fixtures).success, true);
  assert.deepEqual(validateJson(schema, schema, clone(fixtures)), []);
});

test('the JSON Schema rejects what the zod schema rejects structurally', () => {
  const schema = partLibraryJsonSchema();
  const cases: [string, (library: Record<string, any>) => void, string][] = [
    ['unknown key on the library', library => { library.extra = 1; }, '/extra'],
    ['unknown key on a part', library => { library.parts[0].colour = 'rot'; }, '/parts/0/colour'],
    ['unknown key on a body', library => { library.parts[0].bodies[0].radius = 5; }, '/parts/0/bodies/0'],
    ['missing name', library => { delete library.parts[0].name; }, '/parts/0/name'],
    ['wrong type for a revision', library => { library.parts[0].revision = '1'; }, '/parts/0/revision'],
    ['unknown body kind', library => { library.parts[0].bodies[0].kind = 'sphere'; }, '/parts/0/bodies/0'],
    ['unknown parameter scope', library => { library.parts[0].parameters[0].scope = 'global'; }, '/parts/0/parameters/0'],
    ['a key that is not an identifier', library => { library.parts[0].parameters[0].key = '1 breit'; }, '/parts/0/parameters/0'],
    ['wrong schema version', library => { library.schemaVersion = 99; }, '/schemaVersion'],
    ['material without a key', library => { delete library.materials[0].key; }, '/materials/0'],
  ];
  for (const [label, mutate, where] of cases) {
    const library = clone(STARTER_LIBRARY) as Record<string, any>;
    mutate(library);
    assert.equal(partLibrarySchema.safeParse(library).success, false, `${label}: zod rejects`);
    const errors = validateJson(schema, schema, library);
    assert.ok(errors.length > 0, `${label}: JSON Schema rejects`);
    assert.ok(errors.some(error => error.path.startsWith(where)), `${label}: reported at ${where}, got ${errors.map(error => error.path).join(', ')}`);
  }
});

test('cross-field rules are left to the zod schema', () => {
  // The JSON Schema describes structure only: a duplicate parameter key passes it and fails zod.
  const schema = partLibraryJsonSchema();
  const library = clone(STARTER_LIBRARY) as Record<string, any>;
  library.parts[0].parameters.push(clone(library.parts[0].parameters[0]));
  assert.deepEqual(validateJson(schema, schema, library), []);
  assert.equal(partLibrarySchema.safeParse(library).success, false);
});
