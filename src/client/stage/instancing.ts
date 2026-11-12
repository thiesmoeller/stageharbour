/**
 * Instanced drawing, keyed generically: placements that share a geometry key and a material are
 * drawn by one InstancedMesh, whatever element they belong to. Callers describe placements as
 * `StageInstance`s; nothing here knows about chairs or decks.
 */
import { Euler, Matrix4, Quaternion, Vector3, type BufferGeometry, type InstancedMesh, type Material, type Object3D } from 'three';

export type StageInstance = {
  /** Identifies the geometry (see `geometryKey`); equal keys must mean equal geometry. */
  geometryKey: string;
  buildGeometry: () => BufferGeometry;
  /** A shared material: its identity is the material key, so reuse one object per look. */
  material: Material | Material[];
  /** Placement in the space of the group that renders the batches. */
  matrix: Matrix4;
  castShadow?: boolean;
  receiveShadow?: boolean;
};

/**
 * What a group of instances belongs to: stands in for the parent chain an instance does not have.
 * The default event type accepts an owner for any event; the renderer narrows it when it dispatches.
 */
export type InstanceOwner<ClickEvent = never> = {
  userData?: Record<string, unknown>;
  onClick?: (event: ClickEvent) => void;
};

export type InstanceBatch = {
  key: string;
  geometryKey: string;
  buildGeometry: () => BufferGeometry;
  material: Material | Material[];
  castShadow: boolean;
  receiveShadow: boolean;
  /** Index in this list is the instance id. */
  items: { matrix: Matrix4; owner?: InstanceOwner }[];
};

export function instanceBatchKey(geometryKey: string, materialKey: string, castShadow = false, receiveShadow = false) {
  return `${geometryKey}#${materialKey}#${castShadow ? 'c' : '-'}${receiveShadow ? 'r' : '-'}`;
}

/** Groups placements into batches, in order of first appearance. */
export function batchInstances(groups: Iterable<{ instances: readonly StageInstance[]; owner?: InstanceOwner }>): InstanceBatch[] {
  const batches = new Map<string, InstanceBatch>();
  for (const group of groups) {
    for (const instance of group.instances) {
      const castShadow = instance.castShadow ?? false, receiveShadow = instance.receiveShadow ?? false;
      const materialKey = Array.isArray(instance.material)
        ? instance.material.map(material => material.uuid).join(',')
        : instance.material.uuid;
      const key = instanceBatchKey(instance.geometryKey, materialKey, castShadow, receiveShadow);
      let batch = batches.get(key);
      if (!batch) {
        batch = { key, geometryKey: instance.geometryKey, buildGeometry: instance.buildGeometry, material: instance.material, castShadow, receiveShadow, items: [] };
        batches.set(key, batch);
      }
      batch.items.push({ matrix: instance.matrix, owner: group.owner });
    }
  }
  return [...batches.values()];
}

export type InstanceRegistry = {
  /** Replaces the placements registered under `token`. */
  set(token: object, instances: readonly StageInstance[], owner?: InstanceOwner): void;
  delete(token: object): void;
  /** Changes whenever the registered placements change. */
  version(): number;
  subscribe(listener: () => void): () => void;
  batches(): readonly InstanceBatch[];
  /** Every placement registered for `owner`, for example to outline a selection. */
  instancesOf(owner: InstanceOwner): StageInstance[];
};

export function createInstanceRegistry(): InstanceRegistry {
  const groups = new Map<object, { instances: readonly StageInstance[]; owner?: InstanceOwner }>();
  const listeners = new Set<() => void>();
  let version = 0;
  let batched: { version: number; batches: InstanceBatch[] } | undefined;
  const changed = () => {
    version++;
    for (const listener of [...listeners]) listener();
  };
  return {
    set(token, instances, owner) {
      const previous = groups.get(token);
      if (previous && previous.instances === instances && previous.owner === owner) return;
      if (!previous && !instances.length) return;
      groups.set(token, { instances, owner });
      changed();
    },
    delete(token) {
      if (groups.delete(token)) changed();
    },
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    batches() {
      if (batched?.version !== version) batched = { version, batches: batchInstances(groups.values()) };
      return batched.batches;
    },
    instancesOf(owner) {
      const result: StageInstance[] = [];
      for (const group of groups.values()) if (group.owner === owner) result.push(...group.instances);
      return result;
    },
  };
}

/** Smallest power of two that holds `count` instances, at least 4: batches grow without churn. */
export function instanceCapacity(count: number) {
  let capacity = 4;
  while (capacity < count) capacity *= 2;
  return capacity;
}

const OWNERS = 'stageInstanceOwners';

export function setInstanceOwners(mesh: Object3D, owners: readonly (InstanceOwner | undefined)[]) {
  mesh.userData[OWNERS] = owners;
}

/** The owner of one instance of a batch mesh, or undefined for anything else. */
export function instanceOwner(object: Object3D, instanceId: number | undefined): InstanceOwner | undefined {
  if (instanceId === undefined) return undefined;
  return (object.userData[OWNERS] as readonly (InstanceOwner | undefined)[] | undefined)?.[instanceId];
}

/**
 * Looks up `name` in the user data of a raycast hit: on the instance's owner first, then up the
 * parent chain, so instanced and ordinary meshes answer the same question.
 */
export function hitUserData<T>(hit: { object: Object3D; instanceId?: number }, name: string): T | undefined {
  const owned = instanceOwner(hit.object, hit.instanceId)?.userData?.[name];
  if (owned !== undefined) return owned as T;
  for (let node: Object3D | null = hit.object; node; node = node.parent) {
    const value = node.userData?.[name];
    if (value !== undefined) return value as T;
  }
  return undefined;
}

const instanceMatrix = new Matrix4();

/** World-space normal of the face a ray hit, also for one instance of an InstancedMesh. */
export function hitWorldNormal(hit: { object: Object3D; instanceId?: number; face?: { normal: Vector3 } | null }, target: Vector3) {
  if (!hit.face) return undefined;
  target.copy(hit.face.normal);
  const instanced = hit.object as InstancedMesh;
  if (hit.instanceId !== undefined && instanced.isInstancedMesh) {
    instanced.getMatrixAt(hit.instanceId, instanceMatrix);
    instanceMatrix.premultiply(hit.object.matrixWorld);
    return target.transformDirection(instanceMatrix).normalize();
  }
  return target.transformDirection(hit.object.matrixWorld).normalize();
}

const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3(), euler = new Euler();

/** `parent × translate × rotate (XYZ Euler, radians) × scale`: the matrix R3F builds for a nested mesh. */
export function placeMatrix(
  parent: Matrix4 | undefined,
  at: readonly [number, number, number],
  size: readonly [number, number, number] = [1, 1, 1],
  rotation: readonly [number, number, number] = [0, 0, 0],
) {
  position.set(at[0], at[1], at[2]);
  scale.set(size[0], size[1], size[2]);
  quaternion.setFromEuler(euler.set(rotation[0], rotation[1], rotation[2]));
  const matrix = new Matrix4().compose(position, quaternion, scale);
  return parent ? matrix.premultiply(parent) : matrix;
}

/** One placement of a shared primitive (see the `UNIT_*` geometries). */
export function primitiveInstance(
  primitive: { key: string; build: () => BufferGeometry },
  matrix: Matrix4,
  material: Material,
  shadows: { cast?: boolean; receive?: boolean } = {},
): StageInstance {
  return { geometryKey: primitive.key, buildGeometry: primitive.build, material, matrix, castShadow: shadows.cast ?? false, receiveShadow: shadows.receive ?? false };
}
