import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECIMALS, describeDifferences, diffValues, normalise, stableJson, type Json } from './format.js';

export const GOLDEN_DIR = dirname(fileURLToPath(import.meta.url));

export const GOLDEN_ASPECTS = ['input', 'footprints', 'solids', 'surfaces', 'warnings', 'lists', 'document', 'pdf'] as const;
export type GoldenAspect = (typeof GOLDEN_ASPECTS)[number];

export function updatingGoldens() {
  return process.env.UPDATE_GOLDENS === '1';
}

export function goldenFile(fixture: string, aspect: string) {
  return join(GOLDEN_DIR, fixture, `${aspect}.json`);
}

export function loadGolden<T = Json>(fixture: string, aspect: string): T {
  const file = goldenFile(fixture, aspect);
  if (!existsSync(file)) {
    throw new Error(`Golden file missing: tests/golden/${fixture}/${aspect}.json. Run UPDATE_GOLDENS=1 npm test to create it.`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Compare a freshly computed structure with its stored golden, or rewrite the golden under UPDATE_GOLDENS=1. */
export function checkGolden(fixture: string, aspect: string, actual: unknown, decimals = DECIMALS) {
  const file = goldenFile(fixture, aspect);
  const normalised = normalise(actual, decimals);
  if (updatingGoldens()) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, stableJson(normalised, decimals));
    return;
  }
  const expected = loadGolden(fixture, aspect);
  const differences = diffValues(expected, normalised);
  assert.equal(
    differences.length, 0,
    `Golden mismatch in tests/golden/${fixture}/${aspect}.json (first ${differences.length} differing paths):\n${describeDifferences(differences)}\n`
    + 'If the change is intended, regenerate with UPDATE_GOLDENS=1 npm test and review the diff.',
  );
}

export function goldenFilesOnDisk(): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(GOLDEN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of readdirSync(join(GOLDEN_DIR, entry.name))) {
      if (file.endsWith('.json')) files.push(`${entry.name}/${file}`);
    }
  }
  return files.sort();
}

export function removeGoldenFile(relative: string) {
  rmSync(join(GOLDEN_DIR, relative));
}
