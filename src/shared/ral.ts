/** Theatre-common RAL colours for matte scenic wall paint (Bühnenbild). */
export type RalSwatch = { code: string; name: string; hex: string };

/** Curated palette — not the full RAL catalogue. */
export const RAL_PAINT_SWATCHES: readonly RalSwatch[] = [
  { code: '9010', name: 'Reinweiß', hex: '#F7F4EF' },
  { code: '9016', name: 'Verkehrsweiß', hex: '#F1F0EA' },
  { code: '9001', name: 'Cremeweiß', hex: '#E9E0D2' },
  { code: '7035', name: 'Lichtgrau', hex: '#C5C7C4' },
  { code: '7040', name: 'Fenstergrau', hex: '#989EA1' },
  { code: '7016', name: 'Anthrazitgrau', hex: '#383E42' },
  { code: '9005', name: 'Tiefschwarz', hex: '#0A0A0D' },
  { code: '3020', name: 'Verkehrsrot', hex: '#C1121C' },
  { code: '5010', name: 'Enzianblau', hex: '#0E518D' },
  { code: '6011', name: 'Resedagrün', hex: '#6C7C59' },
  { code: '1003', name: 'Signalgelb', hex: '#F7B500' },
  { code: '8025', name: 'Blassbraun', hex: '#755C49' },
] as const;

export const RAL_CODE_PATTERN = /^[0-9]{4}$/;

/** Layered matte wall paint: slightly rough from decades of overpainting. */
export const WALL_PAINT_ROUGHNESS = 0.72;
export const WALL_PAINT_METALNESS = 0.02;

export function ralLabel(code: string): string {
  const swatch = RAL_PAINT_SWATCHES.find(item => item.code === code);
  return swatch ? `RAL ${code} · ${swatch.name}` : `RAL ${code}`;
}

export function ralHex(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return RAL_PAINT_SWATCHES.find(item => item.code === code)?.hex;
}

export function parseRalCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/^RAL\s+/i, '');
  return RAL_CODE_PATTERN.test(trimmed) ? trimmed : undefined;
}
