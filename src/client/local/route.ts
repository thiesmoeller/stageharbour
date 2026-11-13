export function pathOnly(path: string): string {
  const q = path.indexOf('?');
  return q >= 0 ? path.slice(0, q) : path;
}

export function queryOf(path: string): URLSearchParams {
  const q = path.indexOf('?');
  return new URLSearchParams(q >= 0 ? path.slice(q + 1) : '');
}

function decodeParam(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function match(path: string, pattern: string): Record<string, string> | undefined {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeParam(actual);
    else if (expected !== actual) return undefined;
  }
  return params;
}
