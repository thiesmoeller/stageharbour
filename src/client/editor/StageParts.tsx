import { useContext, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { ResolvedLayoutObject } from '../../shared/layoutObjects.js';
import { buildPartGeometry, placementMatrix } from '../../shared/parts/geometry.js';
import { STARTER_PART_IDS } from '../../shared/parts/starter/index.js';
import { scenePushPullKind } from '../../shared/sceneResize.js';
import { layoutStageDeckModules } from '../../shared/stageDeck.js';
import { UNIT_PLANE } from '../stage/geometryCache.js';
import type { StageInstance } from '../stage/instancing.js';
import { useStageInstances, type StageInstanceOwner } from '../stage/StageInstances.js';
import { WorkspaceMesh } from '../stage/WorkspaceMesh.js';
import { StageInteraction } from './StageElements.js';

const FALLBACK_COLOR = '#c9cfd2';
const SELECTED_EMISSIVE = '#b67c35';
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
  const { selectedIds, onSelect, workspaceId, assets, materials } = useContext(StageInteraction);
  const selected = selectedIds.includes(item.object.id);
  const meshSolids = useMemo(
    () => item.resolved.solids.filter(solid => !(solid.kind === 'box' && solid.assetId)),
    [item.resolved],
  );
  const partGeometry = useMemo(
    () => buildPartGeometry({ solids: meshSolids, faces: item.resolved.faces }),
    [meshSolids, item.resolved.faces],
  );
  useEffect(() => () => partGeometry.geometry.dispose(), [partGeometry]);

  const colors = useMemo(
    () => new Map(materials.map(material => [material.key, material.color])),
    [materials],
  );
  /** Slot groups are per stock material (and face); approximate displayOnly via those keys (e.g. Spanngurt). */
  const displayOnlyMaterials = useMemo(
    () => new Set(meshSolids.filter(solid => solid.displayOnly).map(solid => solid.material)),
    [meshSolids],
  );
  const surfaces = useMemo(() => partGeometry.slots.map(slot => {
    const displayOnly = displayOnlyMaterials.has(slot.material);
    return new MeshStandardMaterial({
      color: colors.get(slot.material) ?? FALLBACK_COLOR,
      roughness: 0.82,
      metalness: 0,
      emissive: selected ? SELECTED_EMISSIVE : '#000000',
      emissiveIntensity: selected ? 0.45 : 0,
      ...(displayOnly ? { transparent: true, opacity: 0.7, depthWrite: false } : {}),
    });
  }), [partGeometry.slots, colors, displayOnlyMaterials, selected]);
  useEffect(() => () => surfaces.forEach(material => material.dispose()), [surfaces]);

  const matrix = useMemo(() => placementMatrix({
    x: item.object.x,
    y: item.object.y,
    rotation: item.object.rotation,
    elevation: item.elevation,
  }), [item.object.x, item.object.y, item.object.rotation, item.elevation]);

  const seams = useMemo(() => deckSeams(item, matrix), [item, matrix]);
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
  useStageInstances(seams, owner);

  return <group matrixAutoUpdate={false} matrix={matrix} onClick={owner.onClick} userData={owner.userData}>
    <mesh geometry={partGeometry.geometry} material={surfaces} castShadow receiveShadow dispose={null} />
    {item.resolved.solids.map(solid => solid.kind === 'box' && solid.assetId
      ? <WorkspaceMesh key={solid.id} workspaceId={workspaceId} asset={assets.find(asset => asset.id === solid.assetId)} solid={solid} /> : null)}
  </group>;
}

/** One multi-material mesh per placed catalog part; deck seams stay instanced. */
export function StageParts({ objects }: { objects: readonly ResolvedLayoutObject[] }) {
  return <>{objects.map(item => <PartInstance key={item.object.id} item={item} />)}</>;
}
