import { z } from 'zod';

/** Frozen PDF layer toggles — what appears on construction sheets. */
export const exportLayersSchema = z.strictObject({
  venueContext: z.boolean().default(true),
  scenery: z.boolean().default(true),
  /** Audience chairs — off by default; construction sheets crop to set pieces. */
  audience: z.boolean().default(false),
  softGoods: z.boolean().default(true),
  constraints: z.boolean().default(true),
  infrastructure: z.boolean().default(true),
  cables: z.boolean().default(true),
  labels: z.boolean().default(true),
  dimensions: z.boolean().default(true),
  orientation: z.boolean().default(true),
  warnings: z.boolean().default(true),
});
export type ExportLayers = z.infer<typeof exportLayersSchema>;

export const defaultExportLayers: ExportLayers = {
  venueContext: true,
  scenery: true,
  audience: false,
  softGoods: true,
  constraints: true,
  infrastructure: true,
  cables: true,
  labels: true,
  dimensions: true,
  orientation: true,
  warnings: true,
};

export const EXPORT_LAYER_OPTIONS: { key: keyof ExportLayers; label: string; hint: string }[] = [
  { key: 'venueContext', label: 'Spielstätte', hint: 'Umriss, feste Wände, Podeste, Treppen' },
  { key: 'scenery', label: 'Bühnenbild', hint: 'Wände, Stützen, Möbel und andere Platzhalter' },
  { key: 'audience', label: 'Publikum', hint: 'Stühle im Zuschauerraum' },
  { key: 'softGoods', label: 'Vorhänge und Traversen', hint: 'Molton, Traversen, Überbauungen' },
  { key: 'constraints', label: 'Freihalten', hint: 'Sicherheits- und Freihaltezonen' },
  { key: 'infrastructure', label: 'Anschlüsse und Korridore', hint: 'Mögliche Kabelwege der Spielstätte' },
  { key: 'cables', label: 'Tatsächliche Kabelwege', hint: 'Für dieses Bühnenbild geplante Kabel' },
  { key: 'labels', label: 'Beschriftungen', hint: 'Positionen, Platten, Objektnamen' },
  { key: 'dimensions', label: 'Maße', hint: 'Millimeterangaben an Objekten' },
  { key: 'orientation', label: 'Ausrichtung', hint: 'V/R, Publikum, Mittellinie' },
  { key: 'warnings', label: 'Hinweise', hint: 'Überbauung, Freihalten, Aufbaunotizen' },
];

export function resolveExportLayers(partial?: Partial<ExportLayers> | null): ExportLayers {
  return { ...defaultExportLayers, ...partial };
}
