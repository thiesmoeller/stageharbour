/**
 * GitHub Pages serves the stable demo and the /preview/ build under one origin
 * (thiesmoeller.github.io). IndexedDB and localStorage are origin-scoped, not
 * path-scoped, so both builds would share one database and one set of keys
 * unless every name includes the Vite base path.
 *
 * Examples for BASE_URL:
 *   '/'                      → ''
 *   '/stageharbour/'         → 'stageharbour'
 *   '/stageharbour/preview/' → 'stageharbour-preview'
 *
 * Node's test runner has no Vite `import.meta.env`. Callers that omit the base
 * then get the root deployment (`/`), which is also what `vite dev` uses.
 */
function deploymentBaseUrl(): string {
  const base = import.meta.env?.BASE_URL;
  return typeof base === 'string' ? base : '/';
}

export function storageScope(baseUrl = deploymentBaseUrl()): string {
  return String(baseUrl ?? '/').replace(/\/+$/, '').replace(/^\//, '').replace(/\//g, '-');
}

/** IndexedDB database for the browser-local workspace of this deployment. */
export function localDatabaseName(baseUrl = deploymentBaseUrl()): string {
  const scope = storageScope(baseUrl);
  return scope ? `stageharbour-local-${scope}` : 'stageharbour-local';
}

/** Prefixed localStorage key so prefs of / and /preview/ do not overwrite each other. */
export function scopedStorageKey(key: string, baseUrl = deploymentBaseUrl()): string {
  const scope = storageScope(baseUrl);
  return scope ? `${key}:${scope}` : key;
}
