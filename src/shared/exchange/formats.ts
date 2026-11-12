/** Light module: file formats and names, no three.js, so the browser UI can import it eagerly. */
export const EXCHANGE_FORMATS = {
  gltf: { extension: 'glb', contentType: 'model/gltf-binary', label: 'glTF' },
  mvr: { extension: 'mvr', contentType: 'application/octet-stream', label: 'MVR' },
} as const;
export type ExchangeFormat = keyof typeof EXCHANGE_FORMATS;

export function isExchangeFormat(value: string): value is ExchangeFormat {
  return Object.hasOwn(EXCHANGE_FORMATS, value);
}

export function exchangeFilename(name: string, id: string, format: ExchangeFormat): string {
  const base = name.replace(/[^\wÄÖÜäöüß\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${base || id.slice(0, 8)}.${EXCHANGE_FORMATS[format].extension}`;
}

export function exchangePath(workspaceId: string, sceneId: string, format: ExchangeFormat): string {
  return `/api/workspaces/${workspaceId}/scenes/${sceneId}/export/${format}`;
}
