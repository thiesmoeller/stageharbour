import { z } from 'zod';
import type { Joint } from './layout.js';
import type { ResolvedLayoutObject } from './layoutObjects.js';

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

type AssemblyObject = Pick<ResolvedLayoutObject, 'object' | 'connectors' | 'footprint'>;

export type AssemblyOrder = {
  /** Objects joined edge to edge by hinge joints, each in assembly order. */
  chains: string[][];
  /** Stored assembly numbers, and numbers in chain order for chain members without one. */
  numbers: Map<string, number>;
};

const centreOf = (item: AssemblyObject) => {
  const points = item.footprint.length ? item.footprint : [{ x: item.object.x, y: item.object.y }];
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
};

/**
 * Assembly order from hinge-edge joints. Each chain starts at its end nearest the audience's
 * left and follows the joints, preferring the left-hand neighbour at a branch; chains are
 * ordered left to right. Stored numbers win; chain members without one get the next free
 * numbers in that order.
 */
export function assemblyOrder(joints: readonly Joint[], objects: readonly AssemblyObject[]): AssemblyOrder {
  const byId = new Map(objects.map(item => [item.object.id, item]));
  const neighbours = new Map<string, Set<string>>();
  const hingeEnd = (end: Joint['a']) =>
    byId.get(end.object)?.connectors.find(connector => connector.id === end.connector)?.kind === 'hinge-edge';
  for (const joint of joints) {
    if (joint.a.object === joint.b.object || !hingeEnd(joint.a) || !hingeEnd(joint.b)) continue;
    for (const [from, to] of [[joint.a.object, joint.b.object], [joint.b.object, joint.a.object]] as const) {
      neighbours.set(from, (neighbours.get(from) ?? new Set()).add(to));
    }
  }
  const centres = new Map(objects.map(item => [item.object.id, centreOf(item)]));
  const leftFirst = (a: string, b: string) => {
    const ca = centres.get(a)!;
    const cb = centres.get(b)!;
    return ca.x - cb.x || ca.y - cb.y || a.localeCompare(b);
  };
  const seen = new Set<string>();
  const chains: string[][] = [];
  for (const id of [...neighbours.keys()].sort(leftFirst)) {
    if (seen.has(id)) continue;
    const members: string[] = [];
    const collect = [id];
    const component = new Set<string>([id]);
    while (collect.length) {
      const next = collect.pop()!;
      members.push(next);
      for (const other of neighbours.get(next) ?? []) if (!component.has(other)) { component.add(other); collect.push(other); }
    }
    const ends = members.filter(member => (neighbours.get(member)?.size ?? 0) <= 1).sort(leftFirst);
    const start = ends[0] ?? [...members].sort(leftFirst)[0]!;
    const order: string[] = [];
    const walk = (current: string) => {
      seen.add(current);
      order.push(current);
      for (const other of [...neighbours.get(current) ?? []].sort(leftFirst)) if (!seen.has(other)) walk(other);
    };
    walk(start);
    chains.push(order);
  }
  const numbers = new Map<string, number>();
  for (const item of objects) if (item.object.assemblyNumber) numbers.set(item.object.id, item.object.assemblyNumber);
  const used = new Set(numbers.values());
  let next = 1;
  for (const id of chains.flat()) {
    if (numbers.has(id)) continue;
    while (used.has(next)) next++;
    numbers.set(id, next);
    used.add(next);
  }
  return { chains, numbers };
}

export const CONNECTION_COMPATIBILITY_NOTICE = 'Verbindungskompatibilität prüft die Crew manuell. Es gibt keine automatische Scharnierprüfung.';
