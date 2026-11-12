import { z } from 'zod';

/**
 * Assembly numbers are assigned once from the audience's left-to-right view
 * (+x audience-right, looking toward +y) and then stored as explicit metadata.
 * Later moves, including rearrangements in other scenes, do not renumber them.
 */
export const panelConnectionSchema = z.strictObject({
  id: z.uuid(), a: z.uuid(), b: z.uuid(),
}).refine(connection => connection.a !== connection.b, 'A connection joins two different walls');
export type PanelConnection = z.infer<typeof panelConnectionSchema>;

export function assemblyCaption(assemblyNumber: number, panelLabel?: string) {
  return panelLabel ? `Position ${assemblyNumber} · Platte ${panelLabel}` : `Position ${assemblyNumber}`;
}

export const CONNECTION_COMPATIBILITY_NOTICE = 'Verbindungskompatibilität prüft die Crew manuell. Es gibt keine automatische Scharnierprüfung.';
