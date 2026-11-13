import { Component, createContext, Suspense, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useLoader, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Box3, BoxGeometry, EdgesGeometry, Group, LineSegments, Matrix4, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Asset, AssetDefinition } from '../../shared/assets.js';
import type { HangPlan } from '../../shared/hangPlan.js';
import { resolveFixtureOutput } from '../../shared/lightBoard.js';
import type { Placeholder as Prop } from '../../shared/placeholders.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';
import type { StageModel } from '../../shared/transforms.js';
import { configureStageGltfLoader } from '../stage/decoders.js';
import { stageGeometries } from '../stage/geometryCache.js';
import { useInstanceRegistry, type StageInstanceOwner } from '../stage/StageInstances.js';
import type { LightBoardLive } from './lightBoardLive.js';
import { StageBrace } from './StageBraces.js';
import { StageConstraint } from './StageConstraints.js';
import type { StageElement } from './stageElements.js';
import { StageLevels } from './StageLevels.js';
import { ElementOwner } from './stageMaterialHooks.js';
import { StagePlaceholder } from './StagePlaceholders.js';
import { WallMesh } from './WallMesh.js';

export type StageInteractionValue = {
  assets: Asset[]; workspaceId: string; mirrorWidth: number; venueEditable?: boolean; model?: StageModel;
  selectedIds: string[]; onSelect?: (id: string, additive: boolean) => void;
  hangPlan?: HangPlan; planDisplay: PlanDisplayOptions;
  stageWidth?: number; stageDepth?: number;
  selectedFixtureId?: string | null;
  onFixtureSelect?: (id: string, additive: boolean) => void;
  lightBoardLive?: LightBoardLive;
};

export const StageInteraction = createContext<StageInteractionValue>({ assets: [], workspaceId: '', mirrorWidth: 0, selectedIds: [], planDisplay: defaultPlanDisplay });

/** Millimetre content lives in a metre scene. */
const MM = 0.001;
const MM_SCALE = new Matrix4().makeScale(MM, MM, MM);

function ModelPlaceholder({ prop, failed = false }: { prop: Prop; failed?: boolean }) {
  return <group><mesh position={[0, prop.height / 2000, 0]}>
    <boxGeometry args={[prop.width / 1000, prop.height / 1000, prop.depth / 1000]} />
    <meshBasicMaterial wireframe color={failed ? '#b64d2e' : '#738b99'} />
  </mesh>{failed && <Html center position={[0, prop.height / 1000, 0]}><span className="model-error">{prop.label}: Modell nicht verfügbar</span></Html>}</group>;
}

/** Shows `fallback` instead of a model that failed to load or parse; a new `resetKey` tries again. */
class ModelErrorBoundary extends Component<{ fallback: ReactNode; resetKey: unknown; children: ReactNode }, { failed: boolean; resetKey: unknown }> {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: unknown }, state: { failed: boolean; resetKey: unknown }) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown) {
    console.warn('Stage model could not be shown', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ModelMesh({ prop, definition }: { prop: Prop; definition: Extract<AssetDefinition, { kind: 'model' }> }) {
  const { workspaceId } = useContext(StageInteraction);
  const source = definition.source;
  const url = source.kind === 'catalog' ? source.url : `${window.location.origin}/api/workspaces/${workspaceId}/assets/files/${source.fileId}`;
  const gltf = useLoader(GLTFLoader, url, configureStageGltfLoader);
  const object = useMemo(() => {
    const result = clone(gltf.scene);
    result.traverse(child => { child.castShadow = true; child.receiveShadow = true; });
    return result;
  }, [gltf]);
  const bounds = useMemo(() => new Box3().setFromObject(object), [object]);
  // glTF and catalogue models face +Z; the theatre audience looks toward −Z, so yaw 180°.
  if (source.kind === 'catalog') return <group rotation={[0, Math.PI, 0]} scale={[prop.width / definition.width, prop.height / definition.height, prop.depth / definition.depth]}>
    <primitive object={object} position={source.offset} rotation={source.rotation} scale={source.scale} dispose={null} />
  </group>;
  const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  if (Math.min(size.x, size.y, size.z) <= 0 || !Number.isFinite(size.length())) throw new Error('Model has no usable bounds');
  // Match the editable millimetre dimensions on each axis.
  const scale: [number, number, number] = [prop.width / 1000 / size.x, prop.height / 1000 / size.y, prop.depth / 1000 / size.z];
  if (scale.some(value => !(value > 0) || !Number.isFinite(value))) throw new Error('Model has no usable bounds');
  return <group rotation={[0, Math.PI, 0]} scale={scale}>
    <primitive object={object} position={[-center.x, -bounds.min.y, -center.z]} dispose={null} />
  </group>;
}

const PUSH_PULL_KINDS = new Set(['wall', 'platform', 'stair', 'overhead', 'placeholder']);

function StageElementContent({ item }: { item: StageElement }) {
  const { assets, model, hangPlan, planDisplay, stageWidth, stageDepth, selectedFixtureId, onFixtureSelect, lightBoardLive } = useContext(StageInteraction);
  const element = item.element;
  if (!model) return null;
  if (element.kind === 'wall') {
    const wall = model.walls.find(solid => solid.id === element.value.id);
    return wall ? <group scale={MM}><WallMesh wall={wall} surfaces={element.value.surfaces} interactionScope={item.scope} /></group> : null;
  }
  if (element.kind === 'brace') {
    const brace = model.braces.find(solid => solid.id === element.value.id);
    return brace ? <StageBrace brace={brace} /> : null;
  }
  if (element.kind === 'platform' || element.kind === 'stair') {
    return <group scale={MM}><StageLevels peerPlatforms={model.platforms} model={{
      platforms: model.platforms.filter(solid => solid.id === element.value.id),
      stairs: model.stairs.filter(solid => solid.id === element.value.id),
    }} /></group>;
  }
  if (element.kind !== 'placeholder') {
    const fixtureLevel = lightBoardLive ? (fixtureId: string) => resolveFixtureOutput(lightBoardLive.get(), fixtureId) : undefined;
    return <group scale={MM}><StageConstraint element={element}
      elevation={element.kind === 'zone' ? model.platforms.find(platform => platform.id === element.value.supportingSurfaceId)?.elevation : 0}
      hangPlan={hangPlan} fixtureLevel={fixtureLevel}
      showTrusses={planDisplay.showTrusses} showLightingFixtures={planDisplay.showLightingFixtures}
      stageWidth={stageWidth ?? model.floor.width} stageDepth={stageDepth ?? model.floor.depth}
      selectedFixtureId={selectedFixtureId} onFixtureSelect={onFixtureSelect} /></group>;
  }
  const prop = element.value, solid = model.placeholders.find(candidate => candidate.id === prop.id);
  if (!prop.assetId) return solid ? <StagePlaceholder item={solid} /> : null;
  const definition = assets.find(asset => asset.id === prop.assetId)?.definition;
  return <group position={[prop.x / 1000, ((solid?.center.y ?? prop.height / 2) - prop.height / 2) / 1000, prop.y / 1000]} rotation={[0, -prop.rotation * Math.PI / 180, 0]}>
    <ModelErrorBoundary fallback={<ModelPlaceholder prop={prop} failed />} resetKey={definition}>
      <Suspense fallback={<ModelPlaceholder prop={prop} />}>
        {definition?.kind === 'model' ? <ModelMesh prop={prop} definition={definition} /> : <ModelPlaceholder prop={prop} failed />}
      </Suspense>
    </ModelErrorBoundary>
  </group>;
}

/**
 * One element of the Raumsicht. Its group carries the mirrored stage orientation and what the
 * tools ask a hit object for (`userData.pushPull`); instanced parts answer through the same owner.
 */
export function StageElementView({ item }: { item: StageElement }) {
  const ref = useRef<Group>(null!);
  const { mirrorWidth, venueEditable, selectedIds, onSelect } = useContext(StageInteraction);
  const element = item.element, id = element.value.id;
  const typedWall = element.kind === 'wall' && !!(element.value.typeId || element.value.panelId);
  const pushPullKind = PUSH_PULL_KINDS.has(element.kind) && !typedWall ? element.kind : undefined;
  const select = useRef<(additive: boolean) => void>(() => {});
  select.current = additive => { if (item.scope === 'scene' || venueEditable) onSelect?.(id, additive); };
  const owner = useMemo<StageInstanceOwner>(() => ({
    userData: { pushPull: { id, kind: pushPullKind, scope: item.scope } },
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      select.current(event.shiftKey || event.ctrlKey || event.metaKey);
    },
  }), [id, pushPullKind, item.scope]);
  return <ElementOwner.Provider value={owner}>
    <group ref={ref} position={[mirrorWidth / 1000, 0, 0]} scale={[-1, 1, 1]} userData={owner.userData} onClick={owner.onClick}>
      <StageElementContent item={item} />
      {selectedIds.includes(id) && <SelectionBounds target={ref} owner={owner} />}
    </group>
  </ElementOwner.Provider>;
}

const OUTLINE_NAME = 'selection-bounds';
const OUTLINE_CLEARANCE_M = 0.02;

/** An oriented box around everything the element draws: its meshes and its instanced parts. */
function SelectionBounds({ target, owner }: { target: React.RefObject<Group | null>; owner: StageInstanceOwner }) {
  const registry = useInstanceRegistry();
  const outline = useRef<LineSegments>(null!);
  const scratch = useMemo(() => ({
    box: new Box3(), corner: new Vector3(), center: new Vector3(), size: new Vector3(), basisScale: new Vector3(),
    rootInverse: new Matrix4(), basis: new Matrix4(), basisInverse: new Matrix4(), world: new Matrix4(),
    local: new Matrix4(), translate: new Matrix4(), scale: new Matrix4(),
  }), []);
  // Edges only: a wireframe box would draw face diagonals through flush cut-outs.
  const edges = useMemo(() => {
    const box = new BoxGeometry(1, 1, 1);
    const geometry = new EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, []);
  useLayoutEffect(() => () => { edges.dispose(); }, [edges]);
  useFrame(() => {
    const root = target.current, marker = outline.current;
    if (!root || !marker) return;
    root.updateWorldMatrix(true, true);
    const { box, corner, center, size, basisScale, rootInverse, basis, basisInverse, world, local, translate, scale } = scratch;
    // The union is taken in the frame of the first part, so the box follows the element's rotation.
    let hasBasis = false;
    box.makeEmpty();
    const include = (bounds: Box3 | null, matrixWorld: Matrix4) => {
      if (!bounds || bounds.isEmpty()) return;
      if (!hasBasis) {
        basis.copy(matrixWorld);
        basisInverse.copy(matrixWorld).invert();
        hasBasis = true;
      }
      const { min, max } = bounds;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        box.expandByPoint(corner.set(x, y, z).applyMatrix4(matrixWorld).applyMatrix4(basisInverse));
      }
    };
    root.traverse(object => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || !mesh.geometry || object.name === OUTLINE_NAME) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      include(mesh.geometry.boundingBox, mesh.matrixWorld);
    });
    for (const instance of registry.instancesOf(owner)) {
      const geometry = stageGeometries.get(instance.geometryKey, instance.buildGeometry);
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      include(geometry.boundingBox, world.copy(root.matrixWorld).multiply(MM_SCALE).multiply(instance.matrix));
    }
    marker.visible = hasBasis && !box.isEmpty();
    if (!marker.visible) return;
    box.getCenter(center);
    box.getSize(size);
    rootInverse.copy(root.matrixWorld).invert();
    translate.makeTranslation(center.x, center.y, center.z);
    // 2 cm of clearance in the scene, expressed in the units of the basis frame on each axis.
    basisScale.setFromMatrixScale(basis);
    const pad = (axis: number) => OUTLINE_CLEARANCE_M / Math.max(1e-9, Math.abs(axis));
    scale.makeScale(size.x + pad(basisScale.x), size.y + pad(basisScale.y), size.z + pad(basisScale.z));
    local.copy(rootInverse).multiply(basis).multiply(translate).multiply(scale);
    marker.matrix.copy(local);
  });
  return <lineSegments ref={outline} name={OUTLINE_NAME} matrixAutoUpdate={false} raycast={() => {}} geometry={edges} frustumCulled={false}>
    <lineBasicMaterial color="#e9a83b" depthTest={false} />
  </lineSegments>;
}
