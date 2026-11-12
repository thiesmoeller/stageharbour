import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { InstancedMesh, type BufferGeometry } from 'three';
import { stageGeometries } from './geometryCache.js';
import {
  createInstanceRegistry, instanceCapacity, setInstanceOwners,
  type InstanceBatch, type InstanceOwner, type InstanceRegistry, type StageInstance,
} from './instancing.js';

export type StageInstanceOwner = InstanceOwner<ThreeEvent<MouseEvent>>;

const RegistryContext = createContext<InstanceRegistry | null>(null);

/** Collects the placements registered below it. `StageInstanceBatches` draws them. */
export function StageInstances({ children }: { children: ReactNode }) {
  const registry = useMemo(createInstanceRegistry, []);
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

export function useInstanceRegistry() {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error('Stage instances need a StageInstances provider');
  return registry;
}

/**
 * Draws `instances` as part of the shared batches for as long as the component is mounted. Keep
 * the array identity stable (useMemo) while nothing changed; a new array re-registers it.
 */
export function useStageInstances(instances: readonly StageInstance[], owner?: StageInstanceOwner) {
  const registry = useInstanceRegistry();
  const token = useRef({}).current;
  useLayoutEffect(() => { registry.set(token, instances, owner as InstanceOwner | undefined); }, [registry, token, instances, owner]);
  useLayoutEffect(() => () => registry.delete(token), [registry, token]);
}

/** A cached geometry, shared with every other user of the key and freed with the last one. */
export function useCachedGeometry(key: string, build: () => BufferGeometry) {
  const geometry = useMemo(() => stageGeometries.get(key, build), [key]);
  useLayoutEffect(() => {
    stageGeometries.retain(key, geometry);
    return () => stageGeometries.release(key);
  }, [key, geometry]);
  return geometry;
}

/**
 * One InstancedMesh per batch. Mount it inside the group whose space the instance matrices are in.
 */
export function StageInstanceBatches() {
  const registry = useInstanceRegistry();
  useSyncExternalStore(registry.subscribe, registry.version);
  return <>{registry.batches().map(batch => <BatchMesh key={batch.key} batch={batch} />)}</>;
}

function BatchMesh({ batch }: { batch: InstanceBatch }) {
  const geometry = useCachedGeometry(batch.geometryKey, batch.buildGeometry);
  const capacity = instanceCapacity(batch.items.length);
  const invalidate = useThree(state => state.invalidate);
  const mesh = useMemo(() => {
    const result = new InstancedMesh(geometry, batch.material, capacity);
    result.name = 'stage-instances';
    result.count = 0;
    return result;
  }, [geometry, batch.material, capacity]);
  useEffect(() => () => { mesh.dispose(); }, [mesh]);
  useLayoutEffect(() => {
    batch.items.forEach((item, index) => mesh.setMatrixAt(index, item.matrix));
    mesh.count = batch.items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = batch.castShadow;
    mesh.receiveShadow = batch.receiveShadow;
    // Culling and raycasting use the bounds of all instances; they are stale after any move.
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    setInstanceOwners(mesh, batch.items.map(item => item.owner));
    invalidate();
  }, [mesh, batch, invalidate]);
  return <primitive object={mesh} onClick={(event: ThreeEvent<MouseEvent>) => {
    if (event.instanceId === undefined) return;
    (batch.items[event.instanceId]?.owner as StageInstanceOwner | undefined)?.onClick?.(event);
  }} />;
}
