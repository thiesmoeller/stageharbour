import { useMemo } from 'react';
import type { BraceSolid } from '../../shared/braceTransforms.js';
import { UNIT_BOX } from '../stage/geometryCache.js';
import { placeMatrix, primitiveInstance } from '../stage/instancing.js';
import type { FlatMaterialSpec } from '../stage/surfaceMaterials.js';
import { useElementInstances, useFlatMaterials } from './stageMaterialHooks.js';

const MATERIALS = {
  slab: { color: '#999b96', roughness: 0.95 }, strap: { color: '#de862a', roughness: 0.95 }, fitting: { color: '#666666', roughness: 0.95 },
  member: { color: '#c4a574', roughness: 0.85 },
} as const satisfies Record<string, FlatMaterialSpec>;

const SOLID = { cast: true, receive: true };

/** One Stützdreieck in millimetres: timber members and ballast, drawn with the shared batches. */
export function StageBrace({ brace }: { brace: BraceSolid }) {
  const materials = useFlatMaterials(MATERIALS);
  const instances = useMemo(() => {
    const elevation = brace.footprint[0]?.y ?? 0;
    const base = placeMatrix(undefined, [brace.center.x, elevation, brace.center.z], [1, 1, 1], [0, brace.rotationY, 0]);
    return [
      ...brace.ballast.map(part => primitiveInstance(UNIT_BOX,
        placeMatrix(base, [part.center.x, part.center.y, part.center.z], [part.size.x, part.size.y, part.size.z], [part.rotation.x, part.rotation.y, part.rotation.z]),
        part.kind === 'slab' ? materials.slab : part.kind === 'strap' ? materials.strap : materials.fitting, SOLID)),
      ...brace.members.map(member => primitiveInstance(UNIT_BOX,
        placeMatrix(base, [member.center.x, member.center.y, member.center.z], [member.size.x, member.size.y, member.size.z], [member.rotation.x, member.rotation.y, member.rotation.z]),
        materials.member, SOLID)),
    ];
  }, [brace, materials]);
  useElementInstances(instances);
  return null;
}
