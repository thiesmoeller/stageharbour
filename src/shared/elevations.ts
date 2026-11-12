import type { Opening } from './wall-types.js';
import type { ConstructionSnapshot } from './export.js';

/**
 * Face-projection convention: each distinct wall facing in a selected explicit
 * group is one labelled orthogonal elevation. Walls that share a facing (same
 * plan rotation) sit on that face at their millimetre positions along it. A 90°
 * corner is two faces, never one flattened width. Openings are drawn on the face
 * that owns their wall. Rectangular openings use left/sill/width/height; arch
 * openings keep that bounding box and add a semicircular crown in elevation paint.
 */
export const ELEVATION_PROJECTION_NOTICE =
  'Jede Wandflucht einer gewählten Gruppe wird als eigene beschriftete Orthogonalansicht dargestellt, nicht als zusammengezogene Breite eines Knicks.';

export type ElevationOpening = {
  id: string; left: number; sill: number; width: number; height: number;
  profile?: Opening['profile'];
};
export type ElevationPanel = {
  wallId: string; label: string; left: number; width: number; height: number;
  assemblyNumber?: number; panelLabel?: string;
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

function alongAxis(x: number, y: number, facing: number) {
  const radians = facing * Math.PI / 180;
  return x * Math.cos(radians) + y * Math.sin(radians);
}

export function elevationFaces(snapshot: ConstructionSnapshot): ElevationFace[] {
  const selected = snapshot.elevationGroupIds ?? [];
  const groups = snapshot.layout.groups ?? [];
  const faces: ElevationFace[] = [];
  for (const groupId of selected) {
    const group = groups.find(item => item.id === groupId);
    if (!group) continue;
    const clusters = new Map<number, ElevationPanel[]>();
    for (const member of group.members) {
      if (member.kind !== 'object') continue;
      const object = snapshot.resolvedObjects.find(item => item.id === member.id);
      if (!object) continue;
      const centre = object.footprint.reduce((sum, point) => ({ x: sum.x + point.x / object.footprint.length, y: sum.y + point.y / object.footprint.length }), { x: 0, y: 0 });
      const facing = wrapFacing(object.rotation);
      const origin = alongAxis(centre.x, centre.y, facing) - object.width / 2;
      const panels = clusters.get(facing) ?? [];
      panels.push({
        wallId: object.id, label: object.label, left: origin,
        width: object.width, height: object.height, openings: [],
        assemblyNumber: object.assemblyNumber, panelLabel: object.stockItemLabel,
      });
      clusters.set(facing, panels);
    }
    const facings = [...clusters.keys()].sort((a, b) => a - b);
    for (const facing of facings) {
      const members = clusters.get(facing) ?? [];
      const minLeft = Math.min(...members.map(panel => panel.left));
      const panels = members.map(panel => ({ ...panel, left: panel.left - minLeft }))
        .sort((a, b) => a.left - b.left);
      const width = Math.max(...panels.map(panel => panel.left + panel.width));
      const height = Math.max(...panels.map(panel => panel.height));
      faces.push({
        groupId, facingDegrees: facing, width, height, panels,
        label: `Ansicht ${facing}°`,
      });
    }
  }
  return faces;
}
