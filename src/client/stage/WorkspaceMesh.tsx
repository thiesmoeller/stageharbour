import { Component, Suspense, use, useMemo, type ReactNode } from 'react';
import { Box3, Vector3, type Object3D } from 'three';
import { Html } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Asset } from '../../shared/assets.js';
import type { ResolvedBox } from '../../shared/parts/resolve.js';
import { getBlob } from '../api.js';
import { configureStageGltfLoader } from './decoders.js';

const loads = new Map<string, Promise<Object3D>>();
export function loadWorkspaceModel(workspaceId: string, fileId: string): Promise<Object3D> {
  const url = `/api/workspaces/${workspaceId}/assets/files/${fileId}`;
  let pending = loads.get(url);
  if (!pending) {
    pending = getBlob(url).then(async blob => {
      const loader = new GLTFLoader();
      configureStageGltfLoader(loader);
      return (await loader.parseAsync(await blob.arrayBuffer(), '')).scene;
    });
    loads.set(url, pending);
    void pending.catch(() => loads.delete(url));
  }
  return pending;
}

function Content({ workspaceId, fileId, solid }: { workspaceId: string; fileId: string; solid: ResolvedBox }) {
  const loaded = use(loadWorkspaceModel(workspaceId, fileId));
  const object = useMemo(() => {
    const copy = clone(loaded);
    copy.traverse(child => { child.castShadow = true; child.receiveShadow = true; });
    return copy;
  }, [loaded]);
  const bounds = useMemo(() => new Box3().setFromObject(object), [object]);
  const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  if (Math.min(size.x, size.y, size.z) <= 0) throw new Error('Modell ohne räumliche Ausdehnung');
  return <group scale={[solid.size.x / size.x, solid.size.y / size.y, solid.size.z / size.z]}>
    <primitive object={object} position={[-center.x, -center.y, -center.z]} dispose={null} />
  </group>;
}
class MeshBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Parent uses millimetres. Embedded GLB materials are retained; only its bounding scale is changed. */
export function WorkspaceMesh({ workspaceId, asset, solid }: { workspaceId: string; asset?: Asset; solid: ResolvedBox }) {
  const source = asset?.definition.kind === 'model' ? asset.definition.source : undefined;
  const fallback = <><mesh><boxGeometry args={[solid.size.x, solid.size.y, solid.size.z]} /><meshBasicMaterial color="#ba493a" wireframe /></mesh>
    <Html center><span role="status">Modelldatei fehlt oder ist nicht lesbar: {solid.label ?? solid.assetId}</span></Html></>;
  return <group position={[solid.center.x, solid.center.y, solid.center.z]} quaternion={[solid.rotation.x, solid.rotation.y, solid.rotation.z, solid.rotation.w]}>
    <Html center style={{ pointerEvents: 'none' }}>
      <span data-testid="workspace-mesh" data-asset-id={solid.assetId} data-state={source?.kind === 'upload' ? 'loading' : 'missing'} hidden />
    </Html>
    {source?.kind === 'upload' ? <MeshBoundary key={source.fileId} fallback={fallback}><Suspense fallback={null}>
      <Content workspaceId={workspaceId} fileId={source.fileId} solid={solid} />
    </Suspense></MeshBoundary> : fallback}
  </group>;
}
