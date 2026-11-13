import type { ConstructionSnapshot } from './export.js';
import { resolveFrozen } from './frozenParts.js';
import { elevationOutline, type ElevationPolygon } from './partDrawings.js';

/**
 * Face-projection convention: each distinct facing of the parts in a selected explicit group is
 * one labelled orthogonal elevation, seen from the audience side. Parts that share a facing
 * (same plan rotation) sit on that face at their millimetre positions along it. A 90° corner is
 * two faces, never one flattened width. Each part shows its `front` faces with their cut-outs;
 * parts without one show the outline of their solids.
 */
export const ELEVATION_PROJECTION_NOTICE =
  'Jede Flucht einer gewählten Gruppe wird als eigene beschriftete Orthogonalansicht der Vorderseiten dargestellt, nicht als zusammengezogene Breite eines Knicks.';

export type ElevationOpening = { id: string; left: number; sill: number; width: number; height: number };
export type ElevationPanel = {
  wallId: string; label: string;
  /** Along the face from its left end; heights above the audience floor. */
  left: number; width: number; bottom: number; height: number;
  assemblyNumber?: number; panelLabel?: string;
  /** Front faces in face coordinates (x along the face, y up). */
  polygons: ElevationPolygon[];
  openings: ElevationOpening[];
};
export type ElevationFace = {
  groupId: string; label: string; facingDegrees: number;
  width: number; height: number; panels: ElevationPanel[];
};

function wrapFacing(rotation: number) {
  let degrees = rotation % 360;
  if (degrees < 0) degrees += 360;
  return Math.round(degrees * 1000) / 1000;
}

export function elevationFaces(snapshot: Pick<ConstructionSnapshot, 'layout' | 'venue' | 'library' | 'stock' | 'elevationGroupIds'>): ElevationFace[] {
  const selected = snapshot.elevationGroupIds ?? [];
  const groups = snapshot.layout.groups ?? [];
  const resolved = resolveFrozen(snapshot);
  const stockLabels = new Map((snapshot.stock?.items ?? []).map(item => [item.id, item.label]));
  const faces: ElevationFace[] = [];
  for (const groupId of selected) {
    const group = groups.find(item => item.id === groupId);
    if (!group) continue;
    const clusters = new Map<number, ElevationPanel[]>();
    for (const member of group.members) {
      if (member.kind !== 'object') continue;
      const item = resolved.byId.get(member.id);
      if (!item) continue;
      const facing = wrapFacing(item.object.rotation);
      const outline = elevationOutline(item, facing);
      const panels = clusters.get(facing) ?? [];
      const assemblyNumber = resolved.assembly.numbers.get(item.object.id);
      const panelLabel = item.object.stockItemId ? stockLabels.get(item.object.stockItemId) : undefined;
      panels.push({
        wallId: item.object.id, label: item.object.label,
        left: outline.left, width: outline.width, bottom: outline.bottom, height: outline.height,
        polygons: outline.polygons, openings: outline.openings,
        ...(assemblyNumber !== undefined ? { assemblyNumber } : {}),
        ...(panelLabel ? { panelLabel } : {}),
      });
      clusters.set(facing, panels);
    }
    for (const facing of [...clusters.keys()].sort((a, b) => a - b)) {
      const members = clusters.get(facing) ?? [];
      const minLeft = Math.min(...members.map(panel => panel.left));
      const shift = (polygon: ElevationPolygon): ElevationPolygon => ({
        outline: polygon.outline.map(point => ({ x: point.x - minLeft, y: point.y })),
        holes: polygon.holes.map(hole => hole.map(point => ({ x: point.x - minLeft, y: point.y }))),
      });
      const panels = members.map(panel => ({ ...panel, left: panel.left - minLeft, polygons: panel.polygons.map(shift) }))
        .sort((a, b) => a.left - b.left);
      const width = Math.max(...panels.map(panel => panel.left + panel.width));
      const height = Math.max(...panels.map(panel => panel.height));
      faces.push({ groupId, facingDegrees: facing, width, height, panels, label: `Ansicht ${facing}°` });
    }
  }
  return faces;
}
