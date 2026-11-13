export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const DECIMALS = 3;
export const INPUT_DECIMALS = 6;

export function roundNumber(value: number, decimals = DECIMALS): number {
  if (!Number.isFinite(value)) throw new Error(`Golden values must be finite numbers, got ${value}.`);
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Sorted keys, numbers rounded to three decimals, no undefined, no dates, no maps. */
export function normalise(value: unknown, decimals = DECIMALS): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return roundNumber(value, decimals);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(item => normalise(item, decimals));
  if (value instanceof Date || value instanceof Map || value instanceof Set) {
    throw new Error('Golden structures must be plain JSON data (no Date, Map or Set).');
  }
  if (typeof value === 'object') {
    const result: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      result[key] = normalise(item, decimals);
    }
    return result;
  }
  throw new Error(`Golden structures must be plain JSON data, got ${typeof value}.`);
}

function compact(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${compact(item)}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}

const INLINE_WIDTH = 110;

function format(value: Json, indent: string): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const flat = compact(value);
  if (indent.length + flat.length <= INLINE_WIDTH) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map(item => `${inner}${format(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${format(item, inner)}`).join(',\n')}\n${indent}}`;
}

/** Diff-friendly JSON: short arrays and objects stay on one line, long ones break per element. */
export function stableJson(value: unknown, decimals = DECIMALS): string {
  return `${format(normalise(value, decimals), '')}\n`;
}

export type ValueDifference = { path: string; expected: unknown; actual: unknown };

export function diffValues(expected: Json, actual: Json, limit = 12): ValueDifference[] {
  const found: ValueDifference[] = [];
  const walk = (a: Json, b: Json, path: string) => {
    if (found.length >= limit) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) found.push({ path: `${path}.length`, expected: a.length, actual: b.length });
      for (let index = 0; index < Math.min(a.length, b.length); index++) walk(a[index]!, b[index]!, `${path}[${index}]`);
      return;
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) {
        const left = (a as Record<string, Json>)[key];
        const right = (b as Record<string, Json>)[key];
        if (left === undefined) found.push({ path: `${path}.${key}`, expected: '(missing)', actual: right });
        else if (right === undefined) found.push({ path: `${path}.${key}`, expected: left, actual: '(missing)' });
        else walk(left, right, `${path}.${key}`);
        if (found.length >= limit) return;
      }
      return;
    }
    if (a !== b) found.push({ path, expected: a, actual: b });
  };
  walk(expected, actual, '$');
  return found;
}

export function describeDifferences(differences: readonly ValueDifference[]): string {
  const clip = (value: unknown) => {
    const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  };
  return differences.map(item => `  ${item.path}\n    expected ${clip(item.expected)}\n    actual   ${clip(item.actual)}`).join('\n');
}
