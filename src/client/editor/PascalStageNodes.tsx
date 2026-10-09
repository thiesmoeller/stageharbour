import { createContext, Suspense, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { registerNode, nodeRegistry, useRegistry, useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core';
import { createMaterialFromPresetRef, ErrorBoundary, useGLTFKTX2, useViewer } from '@pascal-app/viewer';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Box3, BoxGeometry, EdgesGeometry, Group, LineSegments, Matrix4, Mesh, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Asset, AssetDefinition } from '../../shared/assets.js';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import type { Placeholder as Prop } from '../../shared/placeholders.js';
import type { StageModel } from '../../shared/transforms.js';
import { WallMesh } from './WallMesh.js';
import { StageConstraint } from './StageConstraints.js';
import { StageLevels } from './StageLevels.js';
import { StagePlaceholders } from './StagePlaceholders.js';
import { StageBraces } from './StageBraces.js';
import { pascalScene, stageNodeSchema, type StageNode } from './pascalScene.js';

import type { HangPlan } from '../../shared/hangPlan.js';
import type { FixtureBoardOutput } from '../../shared/lightBoard.js';
import { resolveFixtureOutput } from '../../shared/lightBoard.js';
import type { LightBoardLive } from './lightBoardLive.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';

export const StageInteraction = createContext<{
  assets: Asset[]; workspaceId: string; mirrorWidth: number; venueEditable?: boolean; model?: StageModel;
  selectedIds: string[]; onSelect?: (id: string, additive: boolean) => void; onClearSelection?: () => void;
  hangPlan?: HangPlan; planDisplay: PlanDisplayOptions;
  stageWidth?: number; stageDepth?: number;
  selectedFixtureId?: string | null;
  onFixtureSelect?: (id: string, additive: boolean) => void;
  fixtureLevel?: (fixtureId: string) => FixtureBoardOutput;
  lightBoardLive?: LightBoardLive;
  showFixturePools?: boolean;
}>({ assets: [], workspaceId: '', mirrorWidth: 0, selectedIds: [], planDisplay: defaultPlanDisplay });

export function PascalSceneBridge({ layout, venue }: { layout: Layout; venue: VenueGeometry }) {
  useLayoutEffect(() => {
    const scene = pascalScene(layout, venue) as unknown as { nodes: Record<AnyNodeId, AnyNode>; rootNodeIds: AnyNodeId[] };
    // 0.9.2 supports registered custom schemas at runtime but types setScene
    // against the built-in union. Keep that SDK mismatch at this one boundary.
    useScene.temporal.getState().pause();
    useScene.getState().setReadOnly(true);
    const previous = useScene.getState();
    let changed = previous.rootNodeIds.length !== scene.rootNodeIds.length
      || previous.rootNodeIds.some((id, index) => id !== scene.rootNodeIds[index]);
    const nodes = Object.fromEntries(Object.entries(scene.nodes).map(([id, node]) => {
      const old = previous.nodes[id as AnyNodeId];
      if (old && JSON.stringify(old) === JSON.stringify(node)) return [id, old];
      changed = true;
      return [id, node];
    })) as Record<AnyNodeId, AnyNode>;
    if (Object.keys(previous.nodes).length !== Object.keys(nodes).length) changed = true;
    if (!changed) return;
    useScene.setState({ nodes, rootNodeIds: scene.rootNodeIds });
  }, [layout, venue]);
  useLayoutEffect(() => () => {
    useScene.getState().unloadScene();
    useScene.getState().setReadOnly(false);
    useScene.temporal.getState().resume();
    useViewer.getState().resetSelection();
    useViewer.setState({ outliner: { selectedObjects: [], hoveredObjects: [] } });
  }, []);
  return null;
}

function ModelPlaceholder({ prop, failed = false }: { prop: Prop; failed?: boolean }) {
  return <group><mesh position={[0, prop.height / 2000, 0]}>
    <boxGeometry args={[prop.width / 1000, prop.height / 1000, prop.depth / 1000]} />
    <meshBasicMaterial wireframe color={failed ? '#b64d2e' : '#738b99'} />
  </mesh>{failed && <Html center position={[0, prop.height / 1000, 0]}><span className="model-error">{prop.label}: Modell nicht verfügbar</span></Html>}</group>;
}

function ModelMesh({ prop, definition }: { prop: Prop; definition: Extract<AssetDefinition, { kind: 'model' }> }) {
  const { workspaceId } = useContext(StageInteraction);
  const source = definition.source;
  const url = source.kind === 'catalog' ? source.url : `${window.location.origin}/api/workspaces/${workspaceId}/assets/files/${source.fileId}`;
  const gltf = useGLTFKTX2(url);
  const loadedScene = Array.isArray(gltf) ? gltf[0]!.scene : gltf.scene;
  const object = useMemo(() => {
    const result = clone(loadedScene);
    result.traverse(child => { child.castShadow = true; child.receiveShadow = true; });
    return result;
  }, [loadedScene]);
  const bounds = useMemo(() => new Box3().setFromObject(object), [object]);
  // glTF / Pascal catalog forward is +Z; theatre audience looks toward −Z, so yaw 180°.
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

function FinishedWall({ wall, surfaces, interactionScope }: {
  wall: import('../../shared/transforms.js').WallSolid;
  surfaces?: import('../../shared/surfaces.js').WallSurfaces;
  interactionScope: 'venue' | 'scene';
}) {
  return <WallMesh wall={wall} lit surfaces={surfaces} interactionScope={interactionScope} />;
}

function StageNodeRenderer({ node }: { node: StageNode }) {
  const ref = useRef<Group>(null!);
  const { assets, mirrorWidth, model, venueEditable, selectedIds, onSelect, hangPlan, planDisplay, stageWidth, stageDepth, selectedFixtureId, onFixtureSelect, lightBoardLive } = useContext(StageInteraction);
  useRegistry(node.id, node.type, ref);
  const selected = selectedIds.includes(node.element.value.id);
  const element = node.element;
  if (!model) return null;
  const fixtureLevel = lightBoardLive
    ? (fixtureId: string) => resolveFixtureOutput(lightBoardLive.get(), fixtureId)
    : undefined;
  const content = (() => {
    if (element.kind === 'wall') {
      const wall = model.walls.find(item => item.id === element.value.id);
      return wall && <group scale={0.001}><FinishedWall wall={wall} surfaces={element.value.surfaces} interactionScope={node.scope} /></group>;
    }
    if (element.kind === 'brace') return <group scale={0.001}><StageBraces braces={model.braces.filter(item => item.id === element.value.id)} lit /></group>;
    if (element.kind === 'platform' || element.kind === 'stair') return <group scale={0.001}><StageLevels lit model={{ ...model, platforms: model.platforms.filter(item => item.id === element.value.id), stairs: model.stairs.filter(item => item.id === element.value.id) }} peerPlatforms={model.platforms} /></group>;
    if (element.kind === 'overhead' || element.kind === 'truss' || element.kind === 'curtain' || element.kind === 'zone' || element.kind === 'pin' || element.kind === 'corridor') {
      return <group scale={0.001}><StageConstraint element={element}
        elevation={element.kind === 'zone' ? model.platforms.find(p => p.id === element.value.supportingSurfaceId)?.elevation : 0}
        hangPlan={hangPlan} fixtureLevel={fixtureLevel}
        showTrusses={planDisplay.showTrusses} showLightingFixtures={planDisplay.showLightingFixtures}
        stageWidth={stageWidth ?? model.floor.width} stageDepth={stageDepth ?? model.floor.depth}
        selectedFixtureId={selectedFixtureId} onFixtureSelect={onFixtureSelect} /></group>;
    }
    const prop = element.value, solid = model.placeholders.find(item => item.id === prop.id);
    if (!prop.assetId) return <group scale={0.001}><StagePlaceholders lit placeholders={model.placeholders.filter(item => item.id === prop.id)} /></group>;
    const definition = assets.find(asset => asset.id === prop.assetId)?.definition;
    return <group position={[prop.x / 1000, ((solid?.center.y ?? prop.height / 2) - prop.height / 2) / 1000, prop.y / 1000]} rotation={[0, -prop.rotation * Math.PI / 180, 0]}>
      <ErrorBoundary fallback={<ModelPlaceholder prop={prop} failed />} resetKey={definition} scope="stage-model">
        <Suspense fallback={<ModelPlaceholder prop={prop} />}>
          {definition?.kind === 'model' ? <ModelMesh prop={prop} definition={definition} /> : <ModelPlaceholder prop={prop} failed />}
        </Suspense>
      </ErrorBoundary>
    </group>;
  })();
  return <group ref={ref} position={[mirrorWidth / 1000, 0, 0]} scale={[-1, 1, 1]}
    userData={{
      pushPull: {
        id: element.value.id,
        kind: element.kind === 'wall' && (element.value.typeId || element.value.panelId) ? undefined : element.kind === 'wall' || element.kind === 'platform' || element.kind === 'stair' || element.kind === 'overhead' || element.kind === 'placeholder'
          ? element.kind : undefined,
        scope: node.scope,
      },
    }}
    onClick={event => { event.stopPropagation(); if (node.scope === 'scene' || venueEditable) onSelect?.(element.value.id, event.shiftKey || event.ctrlKey || event.metaKey); }}>
    {content}
    {selected && <SelectionBounds target={ref} />}
  </group>;
}

function SelectionBounds({ target }: { target: React.RefObject<Group | null> }) {
  const outline = useRef<LineSegments>(null!);
  const localBox = useMemo(() => new Box3(), []);
  const corner = useMemo(() => new Vector3(), []);
  const center = useMemo(() => new Vector3(), []);
  const size = useMemo(() => new Vector3(), []);
  const rootInv = useMemo(() => new Matrix4(), []);
  const basisInv = useMemo(() => new Matrix4(), []);
  const local = useMemo(() => new Matrix4(), []);
  const translate = useMemo(() => new Matrix4(), []);
  const scaleMat = useMemo(() => new Matrix4(), []);
  // Edges only — boxGeometry + wireframe draws face diagonals that cut through flush Ausschnitte.
  const edges = useMemo(() => {
    const box = new BoxGeometry(1, 1, 1);
    const geometry = new EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, []);
  useLayoutEffect(() => () => { edges.dispose(); }, [edges]);
  useFrame(() => {
    const root = target.current, marker = outline.current, content = root?.children[0];
    if (!root || !marker || !content) return;
    root.updateWorldMatrix(true, true);
    let basis: Mesh | undefined;
    content.traverse(obj => {
      const mesh = obj as Mesh;
      if (mesh.isMesh && mesh.geometry && !basis) basis = mesh;
    });
    if (!basis?.geometry) return;
    // Union mesh bounds in the first mesh's local frame, then compose root-local matrix.
    // Avoid getWorldQuaternion: the audience-left mirror (scale.x = -1) makes that path unstable.
    basisInv.copy(basis.matrixWorld).invert();
    localBox.makeEmpty();
    content.traverse(obj => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (!bb || bb.isEmpty()) return;
      const { min, max } = bb;
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            corner.set(x, y, z).applyMatrix4(mesh.matrixWorld).applyMatrix4(basisInv);
            localBox.expandByPoint(corner);
          }
        }
      }
    });
    if (localBox.isEmpty()) return;
    localBox.getCenter(center);
    localBox.getSize(size);
    rootInv.copy(root.matrixWorld).invert();
    translate.makeTranslation(center.x, center.y, center.z);
    scaleMat.makeScale(size.x + 0.02, size.y + 0.02, size.z + 0.02);
    local.copy(rootInv).multiply(basis.matrixWorld).multiply(translate).multiply(scaleMat);
    marker.matrixAutoUpdate = false;
    marker.matrix.copy(local);
  });
  return <lineSegments ref={outline} matrixAutoUpdate={false} raycast={() => {}} geometry={edges}>
    <lineBasicMaterial color="#e9a83b" depthTest={false} />
  </lineSegments>;
}

if (!nodeRegistry.has('stage-object')) registerNode({
  kind: 'stage-object', schemaVersion: 1, schema: stageNodeSchema, category: 'furnish',
  defaults: () => ({ object: 'node', parentId: null, visible: true, name: 'Bühnenobjekt' }),
  capabilities: { selectable: {}, movable: { axes: ['x', 'z'] }, rotatable: { axes: ['y'] }, snappable: { points: ['start', 'end', 'midpoint', 'corners'] }, duplicable: true, deletable: true, groupable: true }, dirtyTracking: false,
  presentation: { label: 'Bühnenobjekt', icon: { kind: 'iconify', name: 'lucide:theater' } },
  renderer: { kind: 'parametric', module: async () => ({ default: ({ node }: { node: Record<string, unknown> }) => <StageNodeRenderer node={stageNodeSchema.parse(node)} /> }) },
});
