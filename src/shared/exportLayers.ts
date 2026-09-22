import { z } from 'zod';

/** Frozen PDF layer toggles — what appears on construction sheets. */
export const exportLayersSchema = z.strictObject({
  venueContext: z.boolean().default(true),
  scenery: z.boolean().default(true),
  softGoods: z.boolean().default(true),
  constraints: z.boolean().default(true),
  labels: z.boolean().default(true),
  dimensions: z.boolean().default(true),
  orientation: z.boolean().default(true),
  warnings: z.boolean().default(true),
});
export type ExportLayers = z.infer<typeof exportLayersSchema>;

export const defaultExportLayers: ExportLayers = {
  venueContext: true,
  scenery: true,
  softGoods: true,
  constraints: true,
  labels: true,
  dimensions: true,
  orientation: true,
  warnings: true,
};

export const EXPORT_LAYER_OPTIONS: { key: keyof ExportLayers; label: string; hint: string }[] = [
  { key: 'venueContext', label: 'Spielstätte', hint: 'Umriss, feste Wände, Podeste, Treppen' },
  { key: 'scenery', label: 'Bühnenbild', hint: 'Wände, Stützen, Platzhalter' },
  { key: 'softGoods', label: 'Vorhänge und Traversen', hint: 'Molton, Traversen, Überbauungen' },
  { key: 'constraints', label: 'Freihalten und Technik', hint: 'Zonen, Anschlüsse, Kabelkorridore' },
  { key: 'labels', label: 'Beschriftungen', hint: 'Positionen, Platten, Objektnamen' },
  { key: 'dimensions', label: 'Maße', hint: 'Millimeterangaben an Objekten' },
  { key: 'orientation', label: 'Ausrichtung', hint: 'V/R, Publikum, Mittellinie' },
  { key: 'warnings', label: 'Hinweise', hint: 'Überbauung, Freihalten, Aufbaunotizen' },
];

export function resolveExportLayers(partial?: Partial<ExportLayers> | null): ExportLayers {
  return { ...defaultExportLayers, ...partial };
}
