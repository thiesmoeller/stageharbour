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

export function recordConnection<T extends { connections?: PanelConnection[] }>(layout: T, a: string, b: string): T {
  return { ...layout, connections: [...(layout.connections ?? []), { id: crypto.randomUUID(), a, b }] };
}

export function assemblyCaption(assemblyNumber: number, panelLabel?: string) {
  return panelLabel ? `Position ${assemblyNumber} · Platte ${panelLabel}` : `Position ${assemblyNumber}`;
}

export const CONNECTION_COMPATIBILITY_NOTICE = 'Verbindungskompatibilität prüft die Crew manuell. Es gibt keine automatische Scharnierprüfung.';

export function assignAssemblyNumbers<T extends { id: string; x: number; y: number; assemblyNumber?: number }>(walls: readonly T[]): Array<T & { assemblyNumber: number }> {
  const used = new Set(walls.flatMap(wall => wall.assemblyNumber == null ? [] : [wall.assemblyNumber]));
  let next = 1;
  const take = () => {
    while (used.has(next)) next += 1;
    const value = next;
    used.add(value);
    next += 1;
    return value;
  };
  const assigned = new Map(
    walls.filter(wall => wall.assemblyNumber == null)
      .toSorted((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))
      .map(wall => [wall.id, take()]),
  );
  return walls.map(wall => wall.assemblyNumber != null ? wall : { ...wall, assemblyNumber: assigned.get(wall.id)! }) as Array<T & { assemblyNumber: number }>;
}

/** Drop every stored Montagenummer so a fresh left-to-right pass can renumber. */
export function clearAssemblyNumbers<T extends { assemblyNumber?: number }>(walls: readonly T[]): T[] {
  return walls.map(wall => {
    if (wall.assemblyNumber == null) return wall;
    const { assemblyNumber: _removed, ...rest } = wall;
    return rest as T;
  });
}
