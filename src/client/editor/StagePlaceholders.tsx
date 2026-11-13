import { useMemo } from 'react';
import type { Material } from 'three';
import type { PlaceholderSolid } from '../../shared/placeholders.js';
import { UNIT_BOX, UNIT_SPHERE } from '../stage/geometryCache.js';
import { placeMatrix, primitiveInstance, type StageInstance } from '../stage/instancing.js';
import type { FlatMaterialSpec } from '../stage/surfaceMaterials.js';
import { useElementInstances, useFlatMaterials } from './stageMaterialHooks.js';

const MATERIALS = {
  table: { color: '#7d8f6c' }, chair: { color: '#8fa07a' }, person: { color: '#c4a574' }, speaker: { color: '#6a7d92' }, box: { color: '#a09070' },
  chairBack: { color: '#6f805f' }, chairLeg: { color: '#5a6e52' }, figure: { color: '#d9c6a1' }, figureLegs: { color: '#c4a574' },
} as const satisfies Record<string, FlatMaterialSpec>;

const SOLID = { cast: true, receive: true }, CAST = { cast: true };

function chairInstances(item: PlaceholderSolid, materials: Record<keyof typeof MATERIALS, Material>): StageInstance[] {
  const w = item.size.x, h = item.size.y, d = item.size.z;
  const seatH = h * 0.48, seatT = Math.max(20, h * 0.06), backT = Math.max(20, d * 0.08), leg = Math.max(18, Math.min(w, d) * 0.08);
  const base = placeMatrix(undefined, [item.center.x, item.center.y - h / 2, item.center.z], [1, 1, 1], [0, item.rotationY, 0]);
  const parts = [
    primitiveInstance(UNIT_BOX, placeMatrix(base, [0, seatH, 0], [w * 0.92, seatT, d * 0.75]), materials.chair, SOLID),
    primitiveInstance(UNIT_BOX, placeMatrix(base, [0, seatH + (h - seatH) / 2, -d * 0.32], [w * 0.92, h - seatH, backT]), materials.chairBack, SOLID),
    ...([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz]) =>
      primitiveInstance(UNIT_BOX, placeMatrix(base, [sx * (w * 0.38), seatH / 2, sz * (d * 0.28)], [leg, seatH, leg]), materials.chairLeg, CAST)),
  ];
  if (!item.seatedFigure) return parts;
  const figure = placeMatrix(base, [0, seatH + seatT / 2, d * 0.02]);
  const head = Math.min(w, d) * 0.12;
  return [
    ...parts,
    primitiveInstance(UNIT_BOX, placeMatrix(figure, [0, h * 0.18, 0], [w * 0.35, h * 0.28, d * 0.28]), materials.figure, CAST),
    primitiveInstance(UNIT_SPHERE, placeMatrix(figure, [0, h * 0.38, 0], [head, head, head]), materials.figure, CAST),
    primitiveInstance(UNIT_BOX, placeMatrix(figure, [0, h * 0.06, d * 0.12], [w * 0.32, h * 0.12, d * 0.35], [0.4, 0, 0]), materials.figureLegs, CAST),
  ];
}

/** One placeholder solid in millimetres. Equal parts of all placeholders share one draw call. */
export function StagePlaceholder({ item }: { item: PlaceholderSolid }) {
  const materials = useFlatMaterials(MATERIALS);
  const instances = useMemo(() => item.kind === 'chair'
    ? chairInstances(item, materials)
    : [primitiveInstance(UNIT_BOX,
      placeMatrix(undefined, [item.center.x, item.center.y, item.center.z], [item.size.x, item.size.y, item.size.z], [0, item.rotationY, 0]),
      materials[item.kind], SOLID)], [item, materials]);
  useElementInstances(instances);
  return null;
}
