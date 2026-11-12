import { useContext, useMemo } from 'react';
import { MeshStandardMaterial } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { ResolvedLayoutObject } from '../../shared/layoutObjects.js';
import { buildPartGeometry, placementMatrix } from '../../shared/parts/geometry.js';
import { useStageInstances, type StageInstanceOwner } from '../stage/StageInstances.js';
import { StageInteraction } from './StageElements.js';

const material = new MeshStandardMaterial({ color: '#55745f', roughness: 0.72, metalness: 0.04 });
const selectedMaterial = new MeshStandardMaterial({ color: '#b67c35', roughness: 0.65, metalness: 0.03 });

function PartInstance({ item }: { item: ResolvedLayoutObject }) {
  const { selectedIds, onSelect } = useContext(StageInteraction);
  const selected = selectedIds.includes(item.object.id);
  const geometryKey = useMemo(() => `part:${item.object.part.id}@${item.object.part.revision}:${JSON.stringify({
    variant: item.object.variant,
    values: item.object.values,
    state: item.object.state,
  })}`, [item.object.part.id, item.object.part.revision, item.object.variant, item.object.values, item.object.state]);
  const buildGeometry = useMemo(() => () => buildPartGeometry(item.resolved).geometry, [item.resolved]);
  const instances = useMemo(() => [{
    geometryKey,
    buildGeometry,
    material: selected ? selectedMaterial : material,
    matrix: placementMatrix({
      x: item.object.x,
      y: item.object.y,
      rotation: item.object.rotation,
      elevation: item.elevation,
    }),
    castShadow: true,
    receiveShadow: true,
  }], [geometryKey, buildGeometry, selected, item.object.x, item.object.y, item.object.rotation, item.elevation]);
  const owner = useMemo<StageInstanceOwner>(() => ({
    userData: { layoutObjectId: item.object.id },
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onSelect?.(item.object.id, event.shiftKey || event.ctrlKey || event.metaKey);
    },
  }), [item.object.id, onSelect]);
  useStageInstances(instances, owner);
  return null;
}

/** One generic 3D path for every placed catalog part; equal configurations share cached geometry and an instance batch. */
export function StageParts({ objects }: { objects: readonly ResolvedLayoutObject[] }) {
  return <>{objects.map(item => <PartInstance key={item.object.id} item={item} />)}</>;
}
