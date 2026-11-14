import { useContext, useMemo } from 'react';
import { Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { ResolvedLayoutObject } from '../../shared/layoutObjects.js';
import { buildPartGeometry, placementMatrix } from '../../shared/parts/geometry.js';
import { STARTER_PART_IDS } from '../../shared/parts/starter/index.js';
import { scenePushPullKind } from '../../shared/sceneResize.js';
import { layoutStageDeckModules } from '../../shared/stageDeck.js';
import { UNIT_PLANE } from '../stage/geometryCache.js';
import type { StageInstance } from '../stage/instancing.js';
import { useStageInstances, type StageInstanceOwner } from '../stage/StageInstances.js';
import { StageInteraction } from './StageElements.js';

const material = new MeshStandardMaterial({ color: '#55745f', roughness: 0.72, metalness: 0.04 });
const selectedMaterial = new MeshStandardMaterial({ color: '#b67c35', roughness: 0.65, metalness: 0.03 });
const seamMaterial = new MeshStandardMaterial({
  color: '#d7e0cc', roughness: 0.55, metalness: 0.08,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

function deckSeams(item: ResolvedLayoutObject, base: Matrix4): StageInstance[] {
  if (item.object.part.id !== STARTER_PART_IDS.deck) return [];
  const width = item.resolved.derived.W;
  const depth = item.resolved.derived.D;
  if (typeof width !== 'number' || typeof depth !== 'number' || width <= 0 || depth <= 0) return [];
  const modules = layoutStageDeckModules(width, depth, 0);
  if (modules.length < 2) return [];
  const top = (item.resolved.derived.E ?? item.resolved.height) + 2;
  return modules.map(module => {
    const local = new Matrix4().compose(
      new Vector3(module.x, top, module.y),
      new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
      new Vector3(Math.max(1, module.width - 30), Math.max(1, module.depth - 30), 1),
    );
    return {
      geometryKey: UNIT_PLANE.key,
      buildGeometry: UNIT_PLANE.build,
      material: seamMaterial,
      matrix: base.clone().multiply(local),
      receiveShadow: true,
    };
  });
}

function PartInstance({ item }: { item: ResolvedLayoutObject }) {
  const { selectedIds, onSelect } = useContext(StageInteraction);
  const selected = selectedIds.includes(item.object.id);
  const geometryKey = useMemo(() => `part:${item.object.part.id}@${item.object.part.revision}:${JSON.stringify({
    variant: item.object.variant,
    values: item.object.values,
    state: item.object.state,
  })}`, [item.object.part.id, item.object.part.revision, item.object.variant, item.object.values, item.object.state]);
  const buildGeometry = useMemo(() => () => buildPartGeometry(item.resolved).geometry, [item.resolved]);
  const instances = useMemo(() => {
    const matrix = placementMatrix({
      x: item.object.x,
      y: item.object.y,
      rotation: item.object.rotation,
      elevation: item.elevation,
    });
    const body: StageInstance = {
      geometryKey,
      buildGeometry,
      material: selected ? selectedMaterial : material,
      matrix,
      castShadow: true,
      receiveShadow: true,
    };
    return [body, ...deckSeams(item, matrix)];
  }, [geometryKey, buildGeometry, selected, item]);
  const pushPullKind = scenePushPullKind(item.definition);
  const owner = useMemo<StageInstanceOwner>(() => ({
    userData: {
      layoutObjectId: item.object.id,
      ...(pushPullKind ? { pushPull: { id: item.object.id, kind: pushPullKind, scope: 'scene' as const } } : {}),
    },
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onSelect?.(item.object.id, event.shiftKey || event.ctrlKey || event.metaKey);
    },
  }), [item.object.id, onSelect, pushPullKind]);
  useStageInstances(instances, owner);
  return null;
}

/** One generic 3D path for every placed catalog part; equal configurations share cached geometry and an instance batch. */
export function StageParts({ objects }: { objects: readonly ResolvedLayoutObject[] }) {
  return <>{objects.map(item => <PartInstance key={item.object.id} item={item} />)}</>;
}
