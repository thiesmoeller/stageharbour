import type { Asset } from '../../../shared/assets.js';
import { WorkspaceMesh } from '../../stage/WorkspaceMesh.js';
import { Component, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import {
  EdgesGeometry, Matrix4, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3,
  type BufferGeometry, type Group, type Intersection, type Object3D,
} from 'three';
import type { PartDefinition, PartFaceSide, PartMaterial } from '../../../shared/parts/definition.js';
import {
  addBeam, addFaceFromCircle, addFaceFromRect, addSheetFromOutline, alignedSolidAxis, handleLocks, pushPullFace, pushPullNewBody,
  splitBody, type AddResult, type EditResult, type SelectionTargets,
} from '../../../shared/parts/directEdit.js';
import { BOX_SIDE_SLOTS, SHEET_SIDE_SLOTS, buildSolidGeometry } from '../../../shared/parts/geometry.js';
import { handleForPick, partHandles, type Handle } from '../../../shared/parts/handles.js';
import {
  AXIS_COLORS, AXIS_VECTORS, angleAbout, axisOf, inferenceCandidates, pointOnAxis, rayPlane, snapAlongAxis, snapAngle, snapPoint,
  type AxisName, type InferenceCandidates, type Ray, type Snap,
} from '../../../shared/parts/inference.js';
import { add, boundsOf, cross, dot, length, normalize, quatAxes, rotate, scale, sub, type RigidTransform, type Vec3 } from '../../../shared/parts/math.js';
import { solidFace, solidVertices, type ResolvedPart, type ResolvedSolid } from '../../../shared/parts/resolve.js';
import type { StageBounds } from '../../stage/cameraFraming.js';
import { StageCanvas } from '../../stage/StageCanvas.js';
import type { DesignerSelection } from '../draft.js';
import { resolvedGeometryKey } from '../geometryCache.js';
import { sameSelection, solidSelection } from '../views.js';
import {
  axisFromArrowKey, circlePreviewPoints, drawingPlaneLockLabel, drawingPlaneNormal, isPolygonSideCount,
  planeAxes, regularPolygonPoints, squareLockedExtents,
} from './drawHelpers.js';
import { moveEdit as rigidMove, pushPullNewBodyPreview, pushPullPreviewScale, rotateEdit as rigidRotate } from './selectionEdit.js';
import { isTypingTarget, MODEL_TOOLS, type ModelToolId } from './tools.js';

const MM = 0.001;
const FALLBACK_COLOR = '#c9cfd2';
const SNAP_PIXELS = 10;
/** Marquee / accidental-drag threshold. */
const CLICK_PIXELS = 4;
/** First click of a two-click tool: Ctrl+click is twitchy; 4 px silently dropped too many face picks. */
const TOOL_CLICK_PIXELS = 16;
const HIGHLIGHT = '#e59a2f';

/**
 * Ctrl+Neu needs a face handle. Exact side if we hit one; otherwise the face looking at the
 * camera (thin Tischplatte rims often raycast as `edge` even when the user aimed at the top).
 */
function handleForNewBody(
  handles: readonly Handle[],
  solidId: string,
  side: PartFaceSide,
  towardCamera: Vec3,
): Handle | undefined {
  const faces = handles.filter(item => item.solid === solidId && item.kind === 'face');
  const exact = faces.find(item => item.side === side);
  if (exact) return exact;
  if (!faces.length) return undefined;
  return faces.reduce((best, item) =>
    (dot(item.axis, towardCamera) > dot(best.axis, towardCamera) ? item : best));
}

const SIDE_OF_SLOT: Record<'box' | 'sheet', readonly PartFaceSide[]> = {
  box: Object.entries(BOX_SIDE_SLOTS).sort((a, b) => a[1] - b[1]).map(([side]) => side as PartFaceSide),
  sheet: Object.entries(SHEET_SIDE_SLOTS).sort((a, b) => a[1] - b[1]).map(([side]) => side as PartFaceSide),
};

export type ModelEdit = { definition: PartDefinition; select?: DesignerSelection; label: string };

/** What the value box shows and what typing into it changes. */
export type ValueReadout = { label: string; value?: string };

export type ToolController = {
  /** Applies typed values to the running operation, else to the last one. Returns an error text, or nothing on success. */
  applyValue(values: number[]): string | undefined;
};

export type ModelCanvasProps = {
  workspaceId: string;
  assets: readonly Asset[];
  definition: PartDefinition;
  resolved: ResolvedPart | undefined;
  /** Surrounding part when a child is edited in place: drawn dimmed, not editable. */
  surrounding?: { resolved: ResolvedPart; hide: (solid: ResolvedSolid) => boolean };
  /** Placement of the edited model in the surrounding part. */
  frame?: RigidTransform;
  materials: readonly PartMaterial[];
  selection: DesignerSelection | undefined;
  multi: readonly string[];
  tool: ModelToolId;
  readOnly: boolean;
  frameBounds: StageBounds;
  frameRevision: number;
  label: string;
  controller: MutableRefObject<ToolController | null>;
  onSelect: (selection: DesignerSelection | undefined, mode: 'replace' | 'add' | 'toggle') => void;
  /** Replaces the selection with every body or group key inside a selection window. */
  onSelectMany: (keys: string[]) => void;
  onEnterChild: (key: string) => void;
  onPreview: (definition: PartDefinition) => void;
  /** `amend`: replaces the last committed step instead of adding one (typed values after a gesture). */
  onCommit: (edit: ModelEdit, amend: boolean) => void;
  onCancel: () => void;
  onStatus: (message: string | undefined) => void;
  onReadout: (readout: ValueReadout | undefined) => void;
  onDimension: (handle: Handle) => void;
  onInteract: (solid: ResolvedSolid) => void;
  defaultMaterials: { box: string; sheet: string; beam: string };
};

const vec = (v: Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const three = (v: Vec3) => new Vector3(v.x, v.y, v.z);
const formatMm = (value: number) => `${Math.round(value * 10) / 10}`.replace('.', ',');
const childKeyOf = (solid: ResolvedSolid) => solid.path[0]?.replace(/\[.*$/, '');

/**
 * Side slot of the hit triangle. three.js reports material index 0 for every face of a mesh with
 * a single material, so the slot comes from the geometry group that holds the triangle.
 */
function groupSlot(hit: Intersection): number {
  const geometry = (hit.object as Object3D & { geometry?: BufferGeometry }).geometry;
  const position = (hit.faceIndex ?? -1) * 3;
  const group = geometry?.groups.find(item => position >= item.start && position < item.start + item.count);
  return group?.materialIndex ?? hit.face?.materialIndex ?? 0;
}

/** Solids that belong to one selection; a child's key selects all its solids. */
function selectedSolidIds(resolved: ResolvedPart | undefined, selection: DesignerSelection | undefined, multi: readonly string[]): Set<string> {
  const ids = new Set<string>();
  if (!resolved) return ids;
  for (const solid of resolved.solids) {
    if (selection && sameSelection(solidSelection(solid), selection)) ids.add(solid.id);
    else if (!solid.path.length && multi.includes(solid.body)) ids.add(solid.id);
  }
  return ids;
}

class CanvasBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    console.error('Designer 3D canvas failed', error);
  }
  componentDidUpdate(prev: Readonly<{ resetKey: string }>) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    return this.state.failed
      ? <p className="muted designer-preview-failed" role="status">Die 3D-Ansicht ist in diesem Browser nicht verfügbar. Formeln, Optionen und die Ansichten darunter bleiben nutzbar.</p>
      : this.props.children;
  }
}

type Marquee = { x: number; y: number; w: number; h: number; crossing: boolean };

/** The Designer's modelling view: the part on the stage canvas, picked, drawn and edited with the tools. */
export function ModelCanvas(props: ModelCanvasProps) {
  const { resolved, frameBounds } = props;
  const container = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  // Marquee must live outside the R3F tree: createPortal(<div/>) from ModelScene makes Fiber treat Div as a THREE type.
  const [marquee, setMarquee] = useState<Marquee | undefined>();
  const camera = useMemo(() => ({ mode: 'frame' as const, bounds: frameBounds }), [frameBounds]);
  const geometryKey = useMemo(() => resolved ? resolvedGeometryKey(resolved) : '', [resolved]);
  const bounds = resolved?.solids.length
    ? [resolved.bounds.min.x, resolved.bounds.min.y, resolved.bounds.min.z, resolved.bounds.max.x, resolved.bounds.max.y, resolved.bounds.max.z]
      .map(value => Math.round(value * 10) / 10).join(',')
    : '';
  const selectedBounds = useMemo(() => {
    if (!resolved) return '';
    const ids = selectedSolidIds(resolved, props.selection, props.multi);
    const vertices = resolved.solids.filter(solid => ids.has(solid.id)).flatMap(solidVertices);
    if (!vertices.length) return '';
    const { min, max } = boundsOf(vertices);
    return [min.x, min.y, min.z, max.x, max.y, max.z].map(value => Math.round(value * 10) / 10).join(',');
  }, [resolved, props.selection, props.multi]);
  return <div ref={container} className={`designer-preview model-canvas tool-${props.tool}`} data-testid="designer-preview"
    data-solids={resolved?.solids.length ?? 0} data-geometry={geometryKey} data-bounds={bounds} data-selected-bounds={selectedBounds}
    data-tool={props.tool} data-handles="[]">
    <CanvasBoundary resetKey={`${geometryKey}:${props.tool}`}>
      <div className="designer-canvas"><StageCanvas aria-label={props.label} theme="studio" quality="simple" bounds={frameBounds} camera={camera}
        cameraRevision={props.frameRevision} controls={{ buttons: 'editor' }} ground="none">
        <ModelScene {...props} container={container} overlay={overlay} onMarquee={setMarquee} />
      </StageCanvas>
      <div ref={overlay} className="model-overlay">
        {marquee && <div className={marquee.crossing ? 'model-marquee crossing' : 'model-marquee'} data-testid="designer-marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      </div>
      </div>
    </CanvasBoundary>
  </div>;
}

type Hover = { solid?: string; face?: { solid: ResolvedSolid; side: PartFaceSide; edge?: Handle }; locked?: string };

type Overlay = {
  snap?: Snap;
  lines?: { points: Vec3[]; color: string; dashed?: boolean; width?: number }[];
  label?: { at: Vec3; text: string; locked?: boolean };
  pivot?: Vec3;
};

type Drag =
  | { kind: 'move'; targets: SelectionTargets; previewIds: Set<string>; start: Vec3; startDefinition: PartDefinition; startResolved: ResolvedPart; candidates: InferenceCandidates; axis?: AxisName; shiftLocked?: boolean; delta: Vec3; moved: boolean; pointer: { x: number; y: number }; exclude: Set<string>; copy: boolean }
  | { kind: 'rotate'; targets: SelectionTargets; previewIds: Set<string>; phase: 'from' | 'to'; pivot: Vec3; axis: Vec3; home: Vec3; from: Vec3; startDefinition: PartDefinition; startResolved: ResolvedPart; angle: number; moved: boolean; pointer: { x: number; y: number }; copy: boolean }
  | { kind: 'pushpull'; handle: Handle; origin: Vec3; startDefinition: PartDefinition; startResolved: ResolvedPart; candidates: InferenceCandidates; plane: { origin: Vec3; normal: Vec3 }; delta: number; moved: boolean; pointer: { x: number; y: number }; copy: boolean }
  | { kind: 'window'; x0: number; y0: number; x1: number; y1: number };

type Draw =
  | { kind: 'rect'; anchor: Vec3; normal: Vec3; u: Vec3; homeNormal: Vec3; planeLock?: AxisName; opposite?: Vec3; square?: boolean }
  | { kind: 'circle'; centre: Vec3; normal: Vec3; homeNormal: Vec3; planeLock?: AxisName; cursor?: Vec3; segments?: number }
  | { kind: 'ngon'; centre: Vec3; normal: Vec3; homeNormal: Vec3; planeLock?: AxisName; sides: number; cursor?: Vec3 }
  | { kind: 'line'; normal: Vec3; homeNormal: Vec3; planeLock?: AxisName; points: Vec3[]; cursor?: Vec3 }
  | {
    kind: 'split'; body: string; axis: Vec3; index: 0 | 1 | 2; option: number; options: SplitAxisOption[];
    center: Vec3; min: number; max: number; cut: number;
    u: Vec3; v: Vec3; halfU: number; halfV: number;
  }
  | { kind: 'beam'; from: Vec3; cursor?: Vec3 }
  | { kind: 'tape'; from: Vec3; cursor?: Vec3; done?: boolean };

/** What the value box changes after a gesture ended: the step is redone from its start with the typed value. */
type LastStep =
  | { kind: 'move'; target: Drag & { kind: 'move' }; direction: Vec3 }
  | { kind: 'rotate'; target: Drag & { kind: 'rotate' } }
  | { kind: 'pushpull'; target: Drag & { kind: 'pushpull' } }
  | { kind: 'rect'; startDefinition: PartDefinition; draw: Draw & { kind: 'rect' }; key: string }
  | { kind: 'circle'; startDefinition: PartDefinition; draw: Draw & { kind: 'circle' }; radius: number; key: string }
  | { kind: 'ngon'; startDefinition: PartDefinition; draw: Draw & { kind: 'ngon' }; radius: number; key: string }
  | { kind: 'beam'; startDefinition: PartDefinition; from: Vec3; direction: Vec3; key: string }

/** The part axis a face normal stands on, or the floor normal for a slanted face. */
function drawingNormal(normal: Vec3 | undefined): Vec3 {
  const axis = normal && axisOf(normal, 0.999);
  if (!axis || !normal) return { x: 0, y: 1, z: 0 };
  const sign = Math.sign(dot(normal, AXIS_VECTORS[axis]));
  return scale(AXIS_VECTORS[axis], sign || 1);
}

type SplitAxisOption = { index: 0 | 1 | 2; axis: Vec3; label: string };

function solidSplitSize(solid: Extract<ResolvedSolid, { kind: 'box' | 'sheet' }>): readonly [number, number, number] {
  if (solid.kind === 'box') return [solid.size.x, solid.size.y, solid.size.z];
  const xs = solid.outline.map(p => p.x), ys = solid.outline.map(p => p.y);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), solid.thickness];
}

/** Cut axes the Teilen tool may use: three for a box, two in-plane for a sheet (never thickness). */
function splitAxisOptions(solid: Extract<ResolvedSolid, { kind: 'box' | 'sheet' }>): SplitAxisOption[] {
  const axes = quatAxes(solid.rotation);
  const size = solidSplitSize(solid);
  const labels = solid.kind === 'box'
    ? ['Breite (X)', 'Höhe (Y)', 'Tiefe (Z)']
    : ['Breite in der Fläche', 'Höhe in der Fläche', 'Stärke (Dicke)'];
  // Sheets: include thickness so a pulled-up “Würfel” can be split in its tall direction too.
  return ([0, 1, 2] as const).filter(i => size[i]! >= 2).map(i => ({
    index: i,
    axis: i === 0 ? axes.x : i === 1 ? axes.y : axes.z,
    label: labels[i]!,
  }));
}

function splitDraftFromOption(
  solid: Extract<ResolvedSolid, { kind: 'box' | 'sheet' }>,
  options: SplitAxisOption[],
  optionIndex: number,
  cut = 0,
): Draw & { kind: 'split' } {
  const option = options[((optionIndex % options.length) + options.length) % options.length]!;
  const axes = quatAxes(solid.rotation);
  const size = solidSplitSize(solid);
  const extent = size[option.index]!;
  const center = solid.kind === 'box'
    ? solid.center
    : add(solid.origin, rotate(solid.rotation, {
      x: (Math.min(...solid.outline.map(p => p.x)) + Math.max(...solid.outline.map(p => p.x))) / 2,
      y: (Math.min(...solid.outline.map(p => p.y)) + Math.max(...solid.outline.map(p => p.y))) / 2,
      z: solid.thickness / 2,
    }));
  const half = extent / 2;
  const others = ([0, 1, 2] as const).filter(i => i !== option.index) as [0 | 1 | 2, 0 | 1 | 2];
  const axisOfIndex = (i: 0 | 1 | 2) => (i === 0 ? axes.x : i === 1 ? axes.y : axes.z);
  const clamped = Math.min(half - 1, Math.max(-half + 1, cut));
  return {
    kind: 'split', body: solid.body, axis: option.axis, index: option.index,
    option: options.indexOf(option), options, center,
    min: -half, max: half, cut: clamped,
    u: axisOfIndex(others[0]), v: axisOfIndex(others[1]),
    halfU: size[others[0]]! / 2, halfV: size[others[1]]! / 2,
  };
}

/** Draft for the Teilen tool: cut plane through `solid`; `preferred` picks the nearest valid axis. */
function splitDraft(solid: ResolvedSolid, preferred: Vec3): (Draw & { kind: 'split' }) | { error: string } {
  if (solid.path.length) return { error: 'Gruppe mit Doppelklick öffnen, um zu teilen.' };
  if (solid.kind !== 'box' && solid.kind !== 'sheet') {
    return { error: 'Nur Quader und rechteckige Platten lassen sich teilen.' };
  }
  const options = splitAxisOptions(solid);
  if (!options.length) return { error: 'Der Körper ist zu dünn zum Teilen.' };
  const n = normalize(preferred);
  let best = 0;
  let bestScore = -1;
  options.forEach((option, index) => {
    const score = Math.abs(dot(n, option.axis));
    if (score > bestScore) { bestScore = score; best = index; }
  });
  return splitDraftFromOption(solid, options, best);
}

function splitStatus(sketch: Draw & { kind: 'split' }): string {
  const current = sketch.options[sketch.option]!;
  return `Schnitt: ${current.label} (${sketch.option + 1}/${sketch.options.length}). Pfeiltasten wechseln. Lage klicken oder Abstand eintippen.`;
}

function splitPlanePoints(sketch: Draw & { kind: 'split' }): Vec3[] {
  const o = add(sketch.center, scale(sketch.axis, sketch.cut));
  const a = add(o, add(scale(sketch.u, -sketch.halfU), scale(sketch.v, -sketch.halfV)));
  const b = add(o, add(scale(sketch.u, sketch.halfU), scale(sketch.v, -sketch.halfV)));
  const c = add(o, add(scale(sketch.u, sketch.halfU), scale(sketch.v, sketch.halfV)));
  const d = add(o, add(scale(sketch.u, -sketch.halfU), scale(sketch.v, sketch.halfV)));
  return [a, b, c, d, a];
}

function faceLoop(solid: ResolvedSolid, side: PartFaceSide): Vec3[] | undefined {
  const plane = solidFace(solid, side)?.plane;
  if (!plane) return undefined;
  const lift = scale(plane.normal, 0.6);
  const points = plane.outline.map(point => add(add(plane.origin, add(scale(plane.u, point.x), scale(plane.v, point.y))), lift));
  return [...points, points[0]!];
}

/**
 * `overlay` holds the labels: drei's Html removes its elements on unmount, which fails when they
 * sit in a node React has already torn down.
 */
function ModelScene(props: ModelCanvasProps & {
  container: MutableRefObject<HTMLDivElement | null>;
  overlay: MutableRefObject<HTMLDivElement | null>;
  onMarquee: (marquee: Marquee | undefined) => void;
}) {
  const { resolved, definition, selection, multi, tool, readOnly, surrounding, frame, materials } = props;
  const gl = useThree(state => state.gl);
  const cameraObject = useThree(state => state.camera);
  const controls = useThree(state => state.controls) as ({ enabled: boolean } | null);
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const model = useRef<Group>(null);
  const [hover, setHover] = useState<Hover>({});
  const [overlay, setOverlay] = useState<Overlay>({});
  const latest = useRef(props); latest.current = props;
  const drag = useRef<Drag | undefined>(undefined);
  const draw = useRef<Draw | undefined>(undefined);
  const last = useRef<LastStep | undefined>(undefined);
  const lastClick = useRef<{ time: number; solid?: string }>({ time: 0 });
  const lastPushPull = useRef<number | undefined>(undefined);
  /** Vieleck side count for the next centre→radius gesture (default 6). */
  const polygonSides = useRef(6);
  const hoverRef = useRef<Hover>({});
  const meshes = useRef(new Map<string, Object3D>());
  const previewing = useRef<Set<string>>(new Set());

  const handles = useMemo(() => resolved ? partHandles(definition, resolved) : [], [definition, resolved]);
  const selectedIds = useMemo(() => selectedSolidIds(resolved, selection, multi), [resolved, selection, multi]);
  const handlesRef = useRef(handles); handlesRef.current = handles;
  const view = useRef({ cameraObject, size, controls, invalidate });
  view.current = { cameraObject, size, controls, invalidate };
  const previewMatrix = useRef<{ ids: ReadonlySet<string>; matrix: Matrix4 } | null>(null);
  const frameMatrix = useMemo(() => {
    const matrix = new Matrix4();
    if (frame) {
      matrix.compose(three(frame.translation), new Quaternion(frame.rotation.x, frame.rotation.y, frame.rotation.z, frame.rotation.w), new Vector3(1, 1, 1));
    }
    return matrix;
  }, [frame]);

  // A new tool starts clean.
  useEffect(() => {
    draw.current = undefined;
    setOverlay({});
    latest.current.onStatus(MODEL_TOOLS.find(item => item.id === tool)?.hint);
    latest.current.onReadout(undefined);
  }, [tool]);
  // Model-frame helpers.
  const toLocal = (point: Vector3) => model.current ? vec(model.current.worldToLocal(point.clone())) : vec(point);
  const toWorld = (point: Vec3) => model.current ? model.current.localToWorld(three(point)) : three(point);

  function rayAt(clientX: number, clientY: number): { ray: Ray; raycaster: Raycaster } {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, view.current.cameraObject);
    const origin = toLocal(raycaster.ray.origin);
    const ahead = toLocal(raycaster.ray.origin.clone().add(raycaster.ray.direction));
    return { ray: { origin, direction: normalize(sub(ahead, origin)) }, raycaster };
  }

  function pick(clientX: number, clientY: number, exclude?: ReadonlySet<string>) {
    const { ray, raycaster } = rayAt(clientX, clientY);
    const objects = [...meshes.current.values()];
    const hits: Intersection[] = raycaster.intersectObjects(objects, true);
    for (const hit of hits) {
      const id = (hit.object.userData.solidId ?? hit.object.parent?.userData.solidId) as string | undefined;
      if (!id || exclude?.has(id) || !hit.face) continue;
      const solid = latest.current.resolved?.solids.find(item => item.id === id);
      if (!solid) continue;
      const slots = SIDE_OF_SLOT[solid.kind === 'sheet' ? 'sheet' : 'box'];
      const side = slots[groupSlot(hit)] ?? 'all';
      return { solid, side, point: toLocal(hit.point), normal: vec(hit.face.normal), ray };
    }
    return { ray };
  }

  /** Millimetres one screen pixel spans at a model point. */
  function pixelMm(point: Vec3): number {
    const { cameraObject: cam, size: viewport } = view.current;
    const world = toWorld(point);
    let span: number;
    if (cam instanceof OrthographicCamera) span = (cam.top - cam.bottom) / cam.zoom / viewport.height;
    else {
      const distance = cam.position.distanceTo(world);
      const fov = (cam as PerspectiveCamera).fov ?? 45;
      span = 2 * distance * Math.tan(fov * Math.PI / 360) / viewport.height;
    }
    return span / MM;
  }

  function screenOf(point: Vec3): { x: number; y: number } {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = toWorld(point).project(view.current.cameraObject);
    return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  }

  /** Pixels from the canvas's top-left corner, so the readout stays right when the page scrolls without a redraw. */
  function canvasOf(point: Vec3): { x: number; y: number } {
    const { width, height } = gl.domElement.getBoundingClientRect();
    const ndc = toWorld(point).project(view.current.cameraObject);
    return { x: (ndc.x + 1) / 2 * width, y: (1 - ndc.y) / 2 * height };
  }

  function solidIdsForTargets(part: ResolvedPart, targets: SelectionTargets): Set<string> {
    const ids = new Set<string>();
    for (const solid of part.solids) {
      const child = childKeyOf(solid);
      if (child && targets.children.includes(child)) ids.add(solid.id);
      else if (!solid.path.length && targets.bodies.includes(solid.body)) ids.add(solid.id);
    }
    return ids;
  }

  function clearMeshPreview() {
    previewMatrix.current = null;
    for (const id of previewing.current) {
      const object = meshes.current.get(id);
      if (!object) continue;
      object.matrix.identity();
      object.matrixAutoUpdate = true;
      object.updateMatrixWorld(true);
    }
    previewing.current.clear();
    view.current.invalidate();
  }

  function applyMeshPreview(ids: ReadonlySet<string>, matrix: Matrix4) {
    for (const id of previewing.current) {
      if (ids.has(id)) continue;
      const object = meshes.current.get(id);
      if (!object) continue;
      object.matrix.identity();
      object.matrixAutoUpdate = true;
    }
    previewing.current = new Set(ids);
    previewMatrix.current = { ids, matrix: matrix.clone() };
    for (const id of ids) {
      const object = meshes.current.get(id);
      if (!object) continue;
      object.matrixAutoUpdate = false;
      object.matrix.copy(matrix);
      object.updateMatrixWorld(true);
    }
    view.current.invalidate();
  }

  function movePreviewMatrix(delta: Vec3) {
    return new Matrix4().makeTranslation(delta.x, delta.y, delta.z);
  }

  function rotatePreviewMatrix(axis: Vec3, degrees: number, pivot: Vec3) {
    const quaternion = new Quaternion().setFromAxisAngle(three(normalize(axis)), degrees * Math.PI / 180);
    return new Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(new Matrix4().makeRotationFromQuaternion(quaternion))
      .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  }

  /** Scale along an arbitrary axis about `pivot` (push/pull live preview). */
  function scaleAlongAxisMatrix(axis: Vec3, factor: number, pivot: Vec3) {
    const n = normalize(axis);
    const f = factor - 1;
    const stretch = new Matrix4().set(
      1 + f * n.x * n.x, f * n.x * n.y, f * n.x * n.z, 0,
      f * n.y * n.x, 1 + f * n.y * n.y, f * n.y * n.z, 0,
      f * n.z * n.x, f * n.z * n.y, 1 + f * n.z * n.z, 0,
      0, 0, 0, 1,
    );
    return new Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(stretch)
      .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  }

  function updateHover(next: Hover) {
    const prev = hoverRef.current;
    if (
      prev.solid === next.solid
      && prev.locked === next.locked
      && prev.face?.side === next.face?.side
      && prev.face?.solid.id === next.face?.solid.id
      && prev.face?.edge?.id === next.face?.edge?.id
    ) return;
    hoverRef.current = next;
    setHover(next);
  }

  // Readout of projected handle points for browser tests, refreshed with every drawn frame.
  const readout = useRef('');
  useFrame(() => {
    const preview = previewMatrix.current;
    if (preview) {
      for (const id of preview.ids) {
        const object = meshes.current.get(id);
        if (!object) continue;
        object.matrixAutoUpdate = false;
        object.matrix.copy(preview.matrix);
      }
    }
    const element = props.container.current;
    if (!element || !model.current) return;
    const points: { id: string; x: number; y: number }[] = [];
    const reference: [string, Vec3][] = [
      ['origin', { x: 0, y: 0, z: 0 }], ['ground-x', { x: 1000, y: 0, z: 0 }], ['ground-z', { x: 0, y: 0, z: 1000 }], ['ground-xz', { x: 1000, y: 0, z: 1000 }],
    ];
    for (const [id, point] of reference) points.push({ id, ...canvasOf(point) });
    for (const handle of handles) {
      if (!selectedIds.has(handle.solid) || handle.kind === 'rotation') continue;
      points.push({ id: handle.id, ...canvasOf(handle.position) });
    }
    const text = JSON.stringify(points.map(point => ({ id: point.id, x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 })));
    if (text !== readout.current) {
      readout.current = text;
      element.dataset.handles = text;
    }
  });

  function result(outcome: EditResult | AddResult): PartDefinition | undefined {
    if (outcome.ok) return outcome.definition;
    latest.current.onStatus(outcome.message);
    return undefined;
  }

  function moveEdit(state: Drag & { kind: 'move' }, delta: Vec3, copy = state.copy): EditResult {
    return rigidMove(state.startDefinition, state.startResolved, state.targets, delta, copy);
  }
  function rotateEdit(state: Drag & { kind: 'rotate' }, angle: number, copy = state.copy): EditResult {
    return rigidRotate(state.startDefinition, state.startResolved, state.targets, state.axis, angle, state.pivot, copy);
  }
  function pushPullEdit(
    definition: PartDefinition, resolved: ResolvedPart, handle: Handle, distance: number, copy: boolean,
  ): EditResult {
    return copy ? pushPullNewBody(definition, resolved, handle, distance) : pushPullFace(definition, resolved, handle, distance);
  }
  const moveLabel = (delta: Vec3) => `Abstand ${formatMm(length(delta))} mm`;
  const copyModifier = (event: { ctrlKey: boolean; metaKey: boolean }) => event.ctrlKey || event.metaKey;

  /** Live overlay for an in-progress Drücken/Ziehen (mesh scale or Ctrl+Neu ghost). */
  function paintPushPull(state: Drag & { kind: 'pushpull' }, snap?: Snap) {
    const measure = state.handle.measure;
    const collapses = measure !== undefined && measure.value + state.delta <= 1e-3;
    const preview = !state.copy && !collapses ? pushPullPreviewScale(state.handle, state.delta) : undefined;
    const valid = !collapses && (preview !== undefined || Math.abs(state.delta) >= 1);
    const tip = add(state.handle.position, scale(state.handle.axis, state.delta));
    const text = state.copy
      ? `Neu ${formatMm(state.delta)} mm`
      : measure ? `${measure.label} ${formatMm(measure.value + state.delta)} mm` : `${formatMm(state.delta)} mm`;
    if (preview) applyMeshPreview(new Set([state.handle.solid]), scaleAlongAxisMatrix(preview.axis, preview.factor, preview.pivot));
    else clearMeshPreview();
    const ghostSolid = state.copy && state.handle.kind === 'face' && state.handle.side
      ? state.startResolved.solids.find(item => item.id === state.handle.solid)
      : undefined;
    const ghostLines = ghostSolid && state.handle.side && Math.abs(state.delta) >= 1
      ? pushPullNewBodyPreview(state.handle.axis, state.delta, solidFace(ghostSolid, state.handle.side))
        .map(line => ({ ...line, color: '#286a62', dashed: true as const }))
      : [];
    latest.current.onReadout({
      label: state.copy ? 'Neu' : (measure?.label ?? 'Abstand'),
      value: formatMm(state.copy || !measure ? state.delta : measure.value + state.delta),
    });
    setOverlay({
      ...(snap ? { snap } : {}),
      label: { at: tip, text, locked: !valid },
      lines: [
        { points: [state.handle.position, tip], color: '#b77c37', dashed: true },
        ...ghostLines,
      ],
    });
  }

  /** Latch Ctrl/Meta for copy/new-body; returns false when a push/pull edge cannot become a new body. */
  function latchCopy(state: Drag & { copy: boolean }): boolean {
    if (state.copy) return true;
    if (state.kind === 'pushpull' && state.handle.kind !== 'face') {
      latest.current.onStatus('Neuer Körper nur von einer Fläche — bitte die Fläche anklicken, nicht die Kante.');
      return false;
    }
    state.copy = true;
    if (state.kind === 'pushpull') {
      latest.current.onStatus('Neuer Körper: Lage anklicken oder Maß eintippen.');
      if (state.moved) paintPushPull(state);
    }
    return true;
  }

  // The value box drives the running operation, else redoes the last one with the typed value.
  useEffect(() => {
    props.controller.current = {
      applyValue(values) {
        const current = latest.current;
        const [first = 0, second] = values;
        const running = drag.current;
        const sketch = draw.current;
        if (sketch?.kind === 'rect') {
          if (second === undefined) return 'Rechteck: Breite;Tiefe eingeben, zum Beispiel 1200;600.';
          return finishRect(sketch, first, second, false);
        }
        if (sketch?.kind === 'circle') {
          const radius = Math.abs(first);
          if (radius < 1) return 'Kreis: Radius in mm eingeben, optional Radius;Segmente.';
          const segments = second !== undefined && Number.isInteger(second) ? second : sketch.segments;
          return finishCircle(sketch, radius, segments, false);
        }
        if (sketch?.kind === 'ngon') {
          if (second !== undefined) {
            if (!isPolygonSideCount(second)) return 'Vieleck: Radius oder „Radius;Seiten“ eingeben (3–64 Seiten).';
            sketch.sides = second;
            polygonSides.current = second;
          }
          const radius = Math.abs(first);
          if (radius < 1) return 'Vieleck: Radius in mm eingeben, optional Radius;Seiten.';
          return finishNgon(sketch, radius, false);
        }
        if (current.tool === 'polygon' && !sketch && isPolygonSideCount(first) && second === undefined) {
          polygonSides.current = first;
          current.onStatus(`${first}-Eck: Mittelpunkt klicken, dann Radius.`);
          current.onReadout({ label: 'Seiten', value: `${first}` });
          return undefined;
        }
        if (sketch?.kind === 'beam') {
          const direction = sketch.cursor && length(sub(sketch.cursor, sketch.from)) > 0 ? normalize(sub(sketch.cursor, sketch.from)) : { x: 1, y: 0, z: 0 };
          return finishBeam(sketch.from, add(sketch.from, scale(direction, first)), false);
        }
        if (sketch?.kind === 'split') {
          // Typed value = Abstand von der negativen Seite (min) entlang der Schnittachse.
          const fromMin = first;
          sketch.cut = Math.min(sketch.max - 1, Math.max(sketch.min + 1, sketch.min + fromMin));
          return finishSplit(sketch);
        }
        if (sketch?.kind === 'line' && sketch.points.length) {
          const from = sketch.points[sketch.points.length - 1]!;
          const direction = sketch.cursor && length(sub(sketch.cursor, from)) > 0 ? normalize(sub(sketch.cursor, from)) : { x: 1, y: 0, z: 0 };
          sketch.points.push(add(from, scale(direction, first)));
          updateDrawOverlay();
          return undefined;
        }
        if (running?.kind === 'pushpull') {
          const distance = running.copy || !running.handle.measure
            ? first
            : first - running.handle.measure.value;
          const outcome = pushPullEdit(running.startDefinition, running.startResolved, running.handle, distance, running.copy);
          endDrag(false, outcome);
          return outcome.ok ? undefined : outcome.message;
        }
        if (running?.kind === 'move') {
          const direction = length(running.delta) > 0 ? normalize(running.delta) : { x: 1, y: 0, z: 0 };
          const outcome = moveEdit(running, values.length === 3 ? { x: values[0]!, y: values[1]!, z: values[2]! } : scale(direction, first));
          endDrag(false, outcome);
          return outcome.ok ? undefined : outcome.message;
        }
        if (running?.kind === 'rotate') {
          const outcome = rotateEdit(running, first);
          endDrag(false, outcome);
          return outcome.ok ? undefined : outcome.message;
        }
        const step = last.current;
        if (!step) return 'Erst eine Bearbeitung beginnen; dann setzt die Eingabe ihr Maß.';
        if (step.kind === 'pushpull') {
          const { handle, startDefinition, startResolved, copy } = step.target;
          const distance = copy || !handle.measure ? first : first - handle.measure.value;
          const outcome = pushPullEdit(startDefinition, startResolved, handle, distance, copy);
          if (!outcome.ok) return outcome.message;
          current.onCommit({ definition: outcome.definition, label: copy ? 'Drücken/Ziehen (neu)' : 'Drücken/Ziehen' }, true);
          return undefined;
        }
        if (step.kind === 'move') {
          const outcome = moveEdit(step.target, values.length === 3 ? { x: values[0]!, y: values[1]!, z: values[2]! } : scale(step.direction, first));
          if (!outcome.ok) return outcome.message;
          current.onCommit({ definition: outcome.definition, label: 'Verschieben' }, true);
          return undefined;
        }
        if (step.kind === 'rotate') {
          const outcome = rotateEdit(step.target, first);
          if (!outcome.ok) return outcome.message;
          current.onCommit({ definition: outcome.definition, label: 'Drehen' }, true);
          return undefined;
        }
        if (step.kind === 'rect') {
          if (second === undefined) return 'Rechteck: Breite;Tiefe eingeben, zum Beispiel 1200;600.';
          return finishRect(step.draw, first, second, true, step.startDefinition);
        }
        if (step.kind === 'circle') {
          const radius = Math.abs(first);
          if (radius < 1) return 'Kreis: Radius in mm eingeben, optional Radius;Segmente.';
          const segments = second !== undefined && Number.isInteger(second) ? second : step.draw.segments;
          return finishCircle(step.draw, radius, segments, true, step.startDefinition);
        }
        if (step.kind === 'ngon') {
          if (second !== undefined) {
            if (!isPolygonSideCount(second)) return 'Vieleck: Radius oder „Radius;Seiten“ eingeben (3–64 Seiten).';
            step.draw.sides = second;
            polygonSides.current = second;
          }
          const radius = Math.abs(first);
          if (radius < 1) return 'Vieleck: Radius in mm eingeben, optional Radius;Seiten.';
          return finishNgon(step.draw, radius, true, step.startDefinition);
        }
        if (step.kind === 'beam') return finishBeam(step.from, add(step.from, scale(step.direction, first)), true, step.startDefinition);
        return undefined;
      },
    };
    return () => { props.controller.current = null; };
  });

  function finishRect(sketch: Draw & { kind: 'rect' }, width: number | undefined, depth: number | undefined, amend: boolean, base?: PartDefinition): string | undefined {
    const current = latest.current;
    const v = cross(sketch.normal, sketch.u);
    const span = sketch.opposite ? sub(sketch.opposite, sketch.anchor) : { x: 1, y: 0, z: 1 };
    const du = dot(span, sketch.u), dv = dot(span, v);
    let along = width === undefined ? du : width * (Math.sign(du) || 1);
    let across = depth === undefined ? dv : depth * (Math.sign(dv) || 1);
    if (sketch.square && width === undefined && depth === undefined) {
      const locked = squareLockedExtents(along, across, { shift: true, tolerance: 0 });
      along = locked.along;
      across = locked.across;
    }
    const opposite = add(sketch.anchor, add(scale(sketch.u, along), scale(v, across)));
    const start = base ?? current.definition;
    const outcome = addFaceFromRect(start, { corner: sketch.anchor, opposite, u: sketch.u, normal: sketch.normal }, current.defaultMaterials.sheet);
    if (!outcome.ok) return outcome.message;
    const isSquare = Math.abs(Math.abs(along) - Math.abs(across)) < 1e-6;
    current.onCommit({ definition: outcome.definition, select: { kind: 'body', key: outcome.key }, label: isSquare ? 'Quadrat' : 'Rechteck' }, amend);
    last.current = { kind: 'rect', startDefinition: start, draw: { ...sketch, opposite, square: isSquare }, key: outcome.key };
    draw.current = undefined;
    setOverlay({});
    current.onReadout({ label: 'Maße', value: `${formatMm(Math.abs(along))};${formatMm(Math.abs(across))}` });
    if (isSquare) current.onStatus('Quadrat');
    return undefined;
  }

  function finishCircle(
    sketch: Draw & { kind: 'circle' },
    radius: number,
    segments: number | undefined,
    amend: boolean,
    base?: PartDefinition,
  ): string | undefined {
    const current = latest.current;
    const start = base ?? current.definition;
    const outcome = addFaceFromCircle(
      start,
      { centre: sketch.centre, radius: Math.abs(radius), normal: sketch.normal, ...(segments !== undefined ? { segments } : {}) },
      current.defaultMaterials.sheet,
    );
    if (!outcome.ok) return outcome.message;
    current.onCommit({ definition: outcome.definition, select: { kind: 'body', key: outcome.key }, label: 'Kreis' }, amend);
    last.current = {
      kind: 'circle', startDefinition: start,
      draw: { ...sketch, cursor: add(sketch.centre, scale(planeAxes(sketch.normal), Math.abs(radius))), segments },
      radius: Math.abs(radius), key: outcome.key,
    };
    draw.current = undefined;
    setOverlay({});
    current.onReadout({
      label: segments !== undefined ? 'Radius;Segmente' : 'Radius',
      value: segments !== undefined ? `${formatMm(Math.abs(radius))};${segments}` : formatMm(Math.abs(radius)),
    });
    return undefined;
  }

  function finishNgon(sketch: Draw & { kind: 'ngon' }, radius: number, amend: boolean, base?: PartDefinition): string | undefined {
    const current = latest.current;
    const start = base ?? current.definition;
    const points = regularPolygonPoints(sketch.centre, Math.abs(radius), sketch.sides, sketch.normal);
    const outcome = addSheetFromOutline(start, { points, normal: sketch.normal }, current.defaultMaterials.sheet);
    if (!outcome.ok) return outcome.message;
    current.onCommit({ definition: outcome.definition, select: { kind: 'body', key: outcome.key }, label: 'Vieleck' }, amend);
    last.current = {
      kind: 'ngon', startDefinition: start,
      draw: { ...sketch, cursor: add(sketch.centre, scale(planeAxes(sketch.normal), Math.abs(radius))) },
      radius: Math.abs(radius), key: outcome.key,
    };
    draw.current = undefined;
    setOverlay({});
    current.onReadout({ label: 'Radius;Seiten', value: `${formatMm(Math.abs(radius))};${sketch.sides}` });
    return undefined;
  }

  function finishBeam(from: Vec3, to: Vec3, amend: boolean, base?: PartDefinition): string | undefined {
    const current = latest.current;
    const start = base ?? current.definition;
    const outcome = addBeam(start, from, to, current.defaultMaterials.beam);
    if (!outcome.ok) return outcome.message;
    current.onCommit({ definition: outcome.definition, select: { kind: 'body', key: outcome.key }, label: 'Latte' }, amend);
    last.current = { kind: 'beam', startDefinition: start, from, direction: normalize(sub(to, from)), key: outcome.key };
    draw.current = amend ? undefined : { kind: 'beam', from: to };
    current.onReadout({ label: 'Länge', value: formatMm(length(sub(to, from))) });
    updateDrawOverlay();
    return undefined;
  }

  function finishSplit(sketch: Draw & { kind: 'split' }): string | undefined {
    const current = latest.current;
    if (!current.resolved) return 'Kein Modell geladen.';
    const point = add(sketch.center, scale(sketch.axis, sketch.cut));
    const outcome = splitBody(current.definition, current.resolved, sketch.body, sketch.axis, point);
    if (!outcome.ok) return outcome.message;
    current.onCommit({
      definition: outcome.definition,
      select: { kind: 'body', key: outcome.keys[0]! },
      label: 'Teilen',
    }, false);
    draw.current = undefined;
    setOverlay({});
    current.onReadout(undefined);
    current.onStatus(`Geteilt in „${outcome.keys[0]}“ und „${outcome.keys[1]}“.`);
    return undefined;
  }

  function finishLine(sketch: Draw & { kind: 'line' }) {
    const current = latest.current;
    const outcome = addSheetFromOutline(current.definition, { points: sketch.points, normal: sketch.normal }, current.defaultMaterials.sheet);
    if (!outcome.ok) { current.onStatus(outcome.message); return; }
    current.onCommit({ definition: outcome.definition, select: { kind: 'body', key: outcome.key }, label: 'Linie' }, false);
    draw.current = undefined;
    setOverlay({});
  }

  function endDrag(cancel: boolean, outcome?: EditResult) {
    const state = drag.current;
    if (!state) return;
    drag.current = undefined;
    if (state.kind === 'window') { setOverlay({}); return; }
    if (view.current.controls) view.current.controls.enabled = true;
    const current = latest.current;
    if (cancel || !state.moved && !outcome) {
      clearMeshPreview();
      if (state.moved) current.onCancel();
      setOverlay({});
      return;
    }
    if (!outcome && state.kind === 'pushpull' && state.copy && Math.abs(state.delta) < 1) {
      clearMeshPreview();
      current.onStatus('Neuer Körper: bitte weiter ziehen oder ein Maß eintippen (mindestens 1 mm).');
      setOverlay({});
      return;
    }
    const finalOutcome = outcome ?? (state.kind === 'move' ? moveEdit(state, state.delta)
      : state.kind === 'rotate' ? rotateEdit(state, state.angle)
        : pushPullEdit(state.startDefinition, state.startResolved, state.handle, state.delta, state.copy));
    if (!finalOutcome.ok) {
      clearMeshPreview();
      current.onStatus(finalOutcome.message);
      current.onCancel();
      setOverlay({});
      return;
    }
    const label = state.kind === 'move'
      ? (state.copy ? 'Kopieren' : 'Verschieben')
      : state.kind === 'rotate'
        ? (state.copy ? 'Drehen (Kopie)' : 'Drehen')
        : (state.copy ? 'Drücken/Ziehen (neu)' : 'Drücken/Ziehen');
    // Commit (and eager canvas resolve) before dropping the mesh preview, otherwise the
    // finish click flashes the pre-gesture solid for a frame.
    flushSync(() => {
      current.onCommit({ definition: finalOutcome.definition, label }, false);
    });
    clearMeshPreview();
    if (state.kind === 'move') last.current = { kind: 'move', target: state, direction: length(state.delta) > 0 ? normalize(state.delta) : { x: 1, y: 0, z: 0 } };
    else if (state.kind === 'rotate') last.current = { kind: 'rotate', target: state };
    else {
      last.current = { kind: 'pushpull', target: state };
      lastPushPull.current = state.delta;
    }
    setOverlay(previous => ({ label: previous.label }));
  }

  function updateDrawOverlay(snap?: Snap) {
    const sketch = draw.current;
    if (!sketch) { setOverlay(snap ? { snap } : {}); return; }
    const lines: NonNullable<Overlay['lines']> = [];
    let label: Overlay['label'];
    if (sketch.kind === 'rect' && sketch.opposite) {
      const v = cross(sketch.normal, sketch.u);
      const span = sub(sketch.opposite, sketch.anchor);
      const du = dot(span, sketch.u), dv = dot(span, v);
      const a = sketch.anchor, b = add(a, scale(sketch.u, du)), c = add(b, scale(v, dv)), d = add(a, scale(v, dv));
      lines.push({ points: [a, b, c, d, a], color: '#286a62', width: 2 });
      label = {
        at: c,
        text: sketch.square
          ? `Quadrat ${formatMm(Math.abs(du))} mm`
          : `${formatMm(Math.abs(du))} × ${formatMm(Math.abs(dv))} mm`,
      };
      latest.current.onReadout({ label: 'Maße', value: `${formatMm(Math.abs(du))};${formatMm(Math.abs(dv))}` });
      if (sketch.square) latest.current.onStatus('Quadrat');
    }
    if (sketch.kind === 'circle' && sketch.cursor) {
      const radius = length(sub(sketch.cursor, sketch.centre));
      if (radius >= 1) {
        lines.push({ points: circlePreviewPoints(sketch.centre, radius, sketch.normal), color: '#286a62', width: 2 });
        lines.push({ points: [sketch.centre, sketch.cursor], color: '#286a62', dashed: true, width: 1.5 });
        label = { at: sketch.cursor, text: `⌀ ${formatMm(radius * 2)} mm` };
        latest.current.onReadout({
          label: sketch.segments !== undefined ? 'Radius;Segmente' : 'Radius',
          value: sketch.segments !== undefined ? `${formatMm(radius)};${sketch.segments}` : formatMm(radius),
        });
      }
    }
    if (sketch.kind === 'ngon' && sketch.cursor) {
      const radius = length(sub(sketch.cursor, sketch.centre));
      if (radius >= 1) {
        const points = regularPolygonPoints(sketch.centre, radius, sketch.sides, sketch.normal);
        lines.push({ points: [...points, points[0]!], color: '#286a62', width: 2 });
        lines.push({ points: [sketch.centre, sketch.cursor], color: '#286a62', dashed: true, width: 1.5 });
        label = { at: sketch.cursor, text: `${sketch.sides}-Eck · r ${formatMm(radius)} mm` };
        latest.current.onReadout({ label: 'Radius;Seiten', value: `${formatMm(radius)};${sketch.sides}` });
      }
    }
    if (sketch.kind === 'line') {
      const points = sketch.cursor ? [...sketch.points, sketch.cursor] : sketch.points;
      if (points.length > 1) lines.push({ points, color: '#286a62', width: 2 });
      if (sketch.cursor && sketch.points.length) {
        const from = sketch.points[sketch.points.length - 1]!;
        label = { at: sketch.cursor, text: `${formatMm(length(sub(sketch.cursor, from)))} mm` };
        latest.current.onReadout({ label: 'Länge', value: formatMm(length(sub(sketch.cursor, from))) });
      }
    }
    if ((sketch.kind === 'beam' || sketch.kind === 'tape') && sketch.cursor) {
      lines.push({ points: [sketch.from, sketch.cursor], color: sketch.kind === 'tape' ? '#7a4fb5' : '#286a62', dashed: sketch.kind === 'tape', width: 2 });
      const distance = length(sub(sketch.cursor, sketch.from));
      label = { at: sketch.cursor, text: `${formatMm(distance)} mm` };
      latest.current.onReadout({ label: sketch.kind === 'tape' ? 'Abstand' : 'Länge', value: formatMm(distance) });
    }
    if (sketch.kind === 'split') {
      const points = splitPlanePoints(sketch);
      lines.push({ points, color: '#c0392b', width: 2 });
      const fromMin = sketch.cut - sketch.min;
      const mid = add(sketch.center, scale(sketch.axis, sketch.cut));
      label = { at: mid, text: `Schnitt ${formatMm(fromMin)} mm` };
      latest.current.onReadout({ label: 'Abstand', value: formatMm(fromMin) });
    }
    if (snap?.axis && 'from' in sketch) lines.push({ points: [sketch.from, snap.point], color: AXIS_COLORS[snap.axis], width: 1.5 });
    setOverlay({ snap, lines, label });
  }

  // Pointer and key handling: native listeners like the Bühnenbild editor's push/pull, so the
  // orbit controls and the tools share the canvas without fighting over events.
  useEffect(() => {
    const target = gl.domElement;
    const wrapper = props.container.current;
    if (!target || !wrapper) return;
    let down: { x: number; y: number; button: number } | undefined;

    function snapFor(
      event: PointerEvent,
      from?: Vec3,
      plane?: { origin: Vec3; normal: Vec3 },
      exclude?: ReadonlySet<string>,
      cached?: InferenceCandidates,
    ) {
      const hit = pick(event.clientX, event.clientY, exclude);
      const base = hit.solid ? hit.point! : rayPlane(hit.ray, plane?.origin ?? { x: 0, y: 0, z: 0 }, plane?.normal ?? { x: 0, y: 1, z: 0 }) ?? hit.ray.origin;
      const tolerance = SNAP_PIXELS * pixelMm(base);
      const candidates = cached ?? inferenceCandidates(latest.current.resolved ?? { solids: [] }, exclude);
      const snap = snapPoint({
        candidates, ray: hit.ray, tolerance, from, plane, bypass: event.altKey,
        ...(hit.solid && !plane ? { hit: { point: hit.point!, normal: hit.normal!, solid: hit.solid.id } } : {}),
      });
      return { snap, hit };
    }
    /** A snapped point kept in the drawing plane. */
    function inPlane(point: Vec3, plane: { origin: Vec3; normal: Vec3 }): Vec3 {
      return sub(point, scale(plane.normal, dot(sub(point, plane.origin), plane.normal)));
    }

    function targetsFor(solid: ResolvedSolid | undefined): SelectionTargets {
      const current = latest.current;
      const bodies = new Set<string>();
      const children = new Set<string>();
      const addKey = (key: string) => {
        if (current.definition.children?.some(child => child.key === key)) children.add(key);
        else if (current.definition.bodies.some(body => body.key === key)) bodies.add(key);
      };
      if (current.selection?.kind === 'body' || current.selection?.kind === 'child') addKey(current.selection.key);
      for (const key of current.multi) addKey(key);
      const clicked = solid ? (childKeyOf(solid) ?? (!solid.path.length ? solid.body : undefined)) : undefined;
      if (!clicked || (!bodies.has(clicked) && !children.has(clicked))) {
        bodies.clear(); children.clear();
        if (clicked) addKey(clicked);
      }
      return { bodies: [...bodies], children: [...children] };
    }

    function onDown(event: PointerEvent) {
      if (event.button !== 0) return;
      down = { x: event.clientX, y: event.clientY, button: event.button };
      if (latest.current.tool === 'select' && !drag.current) {
        drag.current = { kind: 'window', x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY };
      }
    }

    function onMove(event: PointerEvent) {
      const current = latest.current;
      const state = drag.current;
      if (state?.kind === 'window') {
        state.x1 = event.clientX; state.y1 = event.clientY;
        const canvas = target.getBoundingClientRect();
        if (Math.hypot(state.x1 - state.x0, state.y1 - state.y0) >= CLICK_PIXELS) {
          latest.current.onMarquee({
            x: Math.min(state.x0, state.x1) - canvas.left, y: Math.min(state.y0, state.y1) - canvas.top,
            w: Math.abs(state.x1 - state.x0), h: Math.abs(state.y1 - state.y0), crossing: state.x1 < state.x0,
          });
        }
        return;
      }
      if (state) {
        if (state.kind === 'rotate' && state.phase === 'from') {
          const { ray } = rayAt(event.clientX, event.clientY);
          const onPlane = rayPlane(ray, state.pivot, state.axis);
          if (onPlane) setOverlay({ pivot: state.pivot, lines: [{ points: [state.pivot, onPlane], color: AXIS_COLORS[axisOf(state.axis) ?? 'y'] }], label: { at: onPlane, text: 'Start' } });
          return;
        }
        if (!state.moved && Math.hypot(event.clientX - state.pointer.x, event.clientY - state.pointer.y) < CLICK_PIXELS) return;
        state.moved = true;
        if (state.kind === 'pushpull') {
          const { ray } = rayAt(event.clientX, event.clientY);
          const onPlane = rayPlane(ray, state.plane.origin, state.plane.normal);
          if (!onPlane) return;
          const freeDelta = dot(sub(onPlane, state.origin), state.handle.axis);
          const hit = pick(event.clientX, event.clientY, new Set([state.handle.solid]));
          const { delta, snap } = snapAlongAxis({
            candidates: state.candidates, origin: state.origin, axis: state.handle.axis, freeDelta, ray,
            ...(hit.solid ? { hit: { point: hit.point!, normal: hit.normal!, solid: hit.solid.id } } : {}),
            tolerance: SNAP_PIXELS * pixelMm(onPlane), bypass: event.altKey,
          });
          // Sticky from pointer modifiers; keydown also latches (see onKey) when Ctrl is tapped without moving.
          if (copyModifier(event)) latchCopy(state);
          const measure = state.handle.measure;
          const collapses = measure !== undefined && measure.value + delta <= 1e-3;
          const preview = !state.copy && !collapses ? pushPullPreviewScale(state.handle, delta) : undefined;
          const valid = !collapses && (preview !== undefined || Math.abs(delta) >= 1);
          // Keep the last valid delta so a tiny jitter cannot wipe a usable pull before the second click.
          if (valid) state.delta = delta;
          paintPushPull(state, snap);
          return;
        }
        if (state.kind === 'move') {
          const plane = { origin: state.start, normal: { x: 0, y: 1, z: 0 } };
          let point: Vec3;
          let snap: Snap | undefined;
          if (event.shiftKey) {
            const hinted = snapFor(event, state.start, undefined, state.exclude, state.candidates).snap;
            if (hinted?.axis) { state.axis = hinted.axis; state.shiftLocked = true; }
          } else if (state.shiftLocked) {
            state.axis = undefined;
            state.shiftLocked = false;
          }
          if (state.axis) {
            point = pointOnAxis(rayAt(event.clientX, event.clientY).ray, state.start, AXIS_VECTORS[state.axis], 1, event.altKey);
          } else {
            const found = snapFor(event, state.start, undefined, state.exclude, state.candidates);
            snap = found.snap;
            point = found.snap?.point ?? state.start;
            if (!found.hit.solid && !found.snap?.solid && found.snap?.kind !== 'axis') point = inPlane(point, plane);
          }
          if (copyModifier(event)) latchCopy(state);
          const delta = sub(point, state.start);
          state.delta = delta;
          applyMeshPreview(state.previewIds, movePreviewMatrix(delta));
          current.onStatus(undefined);
          current.onReadout({ label: state.copy ? 'Kopie' : 'Abstand', value: formatMm(length(delta)) });
          const color = state.axis ? AXIS_COLORS[state.axis] : snap?.axis ? AXIS_COLORS[snap.axis] : '#b77c37';
          setOverlay({ ...(snap ? { snap } : {}), lines: [{ points: [state.start, point], color, dashed: true }], label: { at: point, text: moveLabel(delta) } });
          return;
        }
        const plane = { origin: state.pivot, normal: state.axis };
        const { snap } = snapFor(event, state.pivot, plane);
        const onPlane = snap
          ? inPlane(snap.point, plane)
          : rayPlane(rayAt(event.clientX, event.clientY).ray, state.pivot, state.axis);
        if (!onPlane) return;
        const angle = snapAngle(angleAbout(state.axis, state.from, sub(onPlane, state.pivot)), event.altKey);
        if (copyModifier(event)) latchCopy(state);
        state.angle = angle;
        applyMeshPreview(state.previewIds, rotatePreviewMatrix(state.axis, angle, state.pivot));
        current.onStatus(undefined);
        current.onReadout({ label: state.copy ? 'Kopie' : 'Winkel', value: `${angle}` });
        const axisName = axisOf(state.axis) ?? 'y';
        setOverlay({
          ...(snap ? { snap } : {}),
          pivot: state.pivot,
          lines: [
            { points: [state.pivot, add(state.pivot, state.from)], color: '#9aa6ad', dashed: true },
            { points: [state.pivot, onPlane], color: AXIS_COLORS[axisName] },
          ],
          label: { at: onPlane, text: `${angle}°` },
        });
        return;
      }

      // Middle/right button: orbit/pan — skip hover thrash.
      if (event.buttons & 6) return;

      const active = current.tool;
      const sketch = draw.current;
      if (active === 'split' && sketch?.kind === 'split') {
        if (current.readOnly) return;
        const hit = pick(event.clientX, event.clientY);
        const point = hit.point
          ?? rayPlane(hit.ray, sketch.center, sketch.axis)
          ?? hit.ray.origin;
        const local = dot(sub(point, sketch.center), sketch.axis);
        sketch.cut = Math.min(sketch.max - 1, Math.max(sketch.min + 1, local));
        updateDrawOverlay();
        return;
      }
      if (active === 'rect' || active === 'line' || active === 'polygon' || active === 'circle' || active === 'beam' || active === 'tape') {
        if (current.readOnly && active !== 'tape') return;
        const plane = sketch && (sketch.kind === 'rect' || sketch.kind === 'line' || sketch.kind === 'circle' || sketch.kind === 'ngon')
          ? {
            origin: sketch.kind === 'rect' ? sketch.anchor
              : sketch.kind === 'line' ? sketch.points[0]!
                : sketch.centre,
            normal: sketch.normal,
          }
          : undefined;
        const from = sketch?.kind === 'rect' ? sketch.anchor
          : sketch?.kind === 'line' ? sketch.points[sketch.points.length - 1]
            : sketch && 'from' in sketch ? sketch.from
              : sketch && (sketch.kind === 'circle' || sketch.kind === 'ngon') ? sketch.centre
                : undefined;
        const { snap } = snapFor(event, from, plane);
        if (!snap) return;
        const point = plane ? inPlane(snap.point, plane) : snap.point;
        if (sketch?.kind === 'rect') {
          const v = cross(sketch.normal, sketch.u);
          const span = sub(point, sketch.anchor);
          const locked = squareLockedExtents(dot(span, sketch.u), dot(span, v), {
            shift: event.shiftKey,
            tolerance: SNAP_PIXELS * pixelMm(point),
          });
          sketch.opposite = add(sketch.anchor, add(scale(sketch.u, locked.along), scale(v, locked.across)));
          sketch.square = locked.square;
          if (!locked.square) current.onStatus('Gegenecke klicken oder Maße eintippen, zum Beispiel 1200;600.');
        } else if (sketch?.kind === 'line') sketch.cursor = point;
        else if (sketch && (sketch.kind === 'circle' || sketch.kind === 'ngon')) sketch.cursor = point;
        else if (sketch && (sketch.kind === 'beam' || (sketch.kind === 'tape' && !sketch.done))) sketch.cursor = point;
        updateDrawOverlay(snap);
        return;
      }
      if (active === 'move' || active === 'rotate') {
        const { snap, hit } = snapFor(event);
        updateHover(hit.solid ? { solid: hit.solid.id } : {});
        setOverlay(snap ? { snap } : {});
        return;
      }
      if (active === 'pushpull' || active === 'select' || active === 'interact') {
        const hit = pick(event.clientX, event.clientY);
        if (!hit.solid) { updateHover({}); return; }
        const solid = hit.solid;
        if (active === 'pushpull' && !solid.path.length) {
          const handle = handleForPick(handlesRef.current, solid.id, hit.side!, hit.point!);
          const locks = handle && current.resolved ? handleLocks(current.definition, current.resolved, handle) : [];
          updateHover({ solid: solid.id, face: { solid, side: hit.side!, ...(handle?.kind === 'edge' ? { edge: handle } : {}) }, ...(locks.length ? { locked: locks[0]!.formula } : {}) });
        } else updateHover({ solid: solid.id });
      }
    }

    function solidsInWindow(rect: { x0: number; y0: number; x1: number; y1: number }): string[] {
      const left = Math.min(rect.x0, rect.x1), right = Math.max(rect.x0, rect.x1);
      const top = Math.min(rect.y0, rect.y1), bottom = Math.max(rect.y0, rect.y1);
      const crossing = rect.x1 < rect.x0;
      const keys = new Set<string>();
      for (const solid of latest.current.resolved?.solids ?? []) {
        const points = solidVertices(solid).map(screenOf);
        if (!points.length) continue;
        const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
        const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
        const inside = minX >= left && maxX <= right && minY >= top && maxY <= bottom;
        const crossed = maxX >= left && minX <= right && maxY >= top && minY <= bottom;
        if (crossing ? crossed : inside) {
          const key = childKeyOf(solid) ?? solid.body;
          if (key) keys.add(key);
        }
      }
      return [...keys];
    }

    function onUp(event: PointerEvent) {
      const start = down;
      down = undefined;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      const state = drag.current;
      if (state?.kind === 'window') {
        drag.current = undefined;
        latest.current.onMarquee(undefined);
        if (start && Math.hypot(event.clientX - state.x0, event.clientY - state.y0) > CLICK_PIXELS) {
          latest.current.onSelectMany(solidsInWindow(state));
          return;
        }
      }
      // Second click of push/pull (etc.): always finish — press jitter must not abort the commit.
      if (state && state.kind !== 'window') {
        click(event);
        return;
      }
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > TOOL_CLICK_PIXELS) return;
      click(event);
    }

    function click(event: PointerEvent) {
      const current = latest.current;
      const active = current.tool;
      if (active === 'select' || active === 'move' || active === 'rotate' || active === 'pushpull') {
        const running = drag.current;
        if (running && running.kind !== 'window') {
          if (active === 'rotate' && running.kind === 'rotate' && running.phase === 'from') {
            const plane = { origin: running.pivot, normal: running.axis };
            const { snap } = snapFor(event, running.pivot, plane);
            const onPlane = snap ? inPlane(snap.point, plane) : rayPlane(rayAt(event.clientX, event.clientY).ray, running.pivot, running.axis);
            if (onPlane) running.from = sub(onPlane, running.pivot);
            if (length(running.from) < 1e-6) running.from = { x: 1, y: 0, z: 0 };
            running.phase = 'to';
            running.moved = false;
            running.pointer = { x: event.clientX, y: event.clientY };
            current.onStatus('Endpunkt der Drehung klicken oder Winkel eintippen.');
            return;
          }
          // Double-click a face repeats the last Drücken/Ziehen distance.
          if (
            running.kind === 'pushpull'
            && !running.moved
            && lastPushPull.current !== undefined
            && performance.now() - lastClick.current.time < 400
            && lastClick.current.solid === running.handle.solid
          ) {
            const distance = lastPushPull.current;
            running.delta = distance;
            running.moved = true;
            if (copyModifier(event)) latchCopy(running);
            lastClick.current = { time: 0 };
            endDrag(false, pushPullEdit(running.startDefinition, running.startResolved, running.handle, distance, running.copy));
            return;
          }
          if (running.kind === 'move' || running.kind === 'rotate' || running.kind === 'pushpull') {
            if (copyModifier(event)) latchCopy(running);
          }
          endDrag(false);
          return;
        }
        const hit = pick(event.clientX, event.clientY);
        const now = performance.now();
        const solid = hit.solid;
        if (solid && now - lastClick.current.time < 400 && lastClick.current.solid === solid.id) {
          const childKey = childKeyOf(solid);
          if (childKey && !current.readOnly) {
            current.onEnterChild(childKey);
            lastClick.current = { time: 0 };
            drag.current = undefined;
            return;
          }
          if (
            active === 'pushpull'
            && !childKey
            && hit.side
            && lastPushPull.current !== undefined
            && current.resolved
          ) {
            const copy = copyModifier(event);
            const cam = view.current.cameraObject;
            const towardCamera = scale(normalize(sub(toLocal(cam.getWorldDirection(new Vector3()).add(cam.position)), toLocal(cam.position.clone()))), -1);
            const handle = copy
              ? handleForNewBody(handlesRef.current, solid.id, hit.side, towardCamera)
              : handleForPick(handlesRef.current, solid.id, hit.side, hit.point!);
            if (handle && handle.kind !== 'point' && handle.kind !== 'rotation') {
              if (copy && handle.kind !== 'face') {
                current.onStatus('Neuer Körper nur von einer Fläche — bitte die Fläche anklicken, nicht die Kante.');
                lastClick.current = { time: 0 };
                return;
              }
              const locks = copy ? [] : handleLocks(current.definition, current.resolved, handle);
              if (!locks.length) {
                const distance = lastPushPull.current;
                const outcome = pushPullEdit(current.definition, current.resolved, handle, distance, copy);
                lastClick.current = { time: 0 };
                if (outcome.ok) {
                  current.onCommit({ definition: outcome.definition, label: copy ? 'Drücken/Ziehen (neu)' : 'Drücken/Ziehen' }, false);
                  last.current = {
                    kind: 'pushpull',
                    target: {
                      kind: 'pushpull', handle, origin: hit.point!, startDefinition: current.definition, startResolved: current.resolved,
                      candidates: { points: [], edges: [] }, plane: { origin: hit.point!, normal: handle.axis },
                      delta: distance, moved: true, pointer: { x: event.clientX, y: event.clientY }, copy,
                    },
                  };
                  lastPushPull.current = distance;
                  current.onReadout({
                    label: copy ? 'Neu' : (handle.measure?.label ?? 'Abstand'),
                    value: formatMm(copy || !handle.measure ? distance : handle.measure.value + distance),
                  });
                } else current.onStatus(outcome.message);
                return;
              }
            }
          }
          lastClick.current = { time: 0 };
          drag.current = undefined;
          return;
        }
        lastClick.current = { time: now, solid: solid?.id };
        if (active === 'select' || !current.resolved) {
          const mode = event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace';
          current.onSelect(solid ? solidSelection(solid) : undefined, mode);
          return;
        }
        const model = current.resolved;
        const childKey = solid ? childKeyOf(solid) : undefined;
        const exclude = new Set(model.solids.filter(item => solid && (childKey ? childKeyOf(item) === childKey : !item.path.length && item.body === solid.body)).map(item => item.id));
        const pointer = { x: event.clientX, y: event.clientY };
        if (active === 'pushpull') {
          if (!solid || childKey || !hit.side) { current.onStatus(childKey ? 'Gruppe mit Doppelklick öffnen, um ihre Flächen zu ziehen.' : 'Eine Fläche anklicken.'); return; }
          const copy = copyModifier(event);
          const cam = view.current.cameraObject;
          const cameraDirection = normalize(sub(toLocal(cam.getWorldDirection(new Vector3()).add(cam.position)), toLocal(cam.position.clone())));
          const towardCamera = scale(cameraDirection, -1);
          // Ctrl+Neu: map rim hits on the thin Neu-Tischplatte to the face facing the camera.
          const handle = copy
            ? handleForNewBody(handlesRef.current, solid.id, hit.side, towardCamera)
            : handleForPick(handlesRef.current, solid.id, hit.side, hit.point!);
          if (!handle || handle.kind === 'point' || handle.kind === 'rotation') return;
          if (copy && handle.kind !== 'face') {
            current.onStatus('Neuer Körper nur von einer Fläche — bitte die Fläche anklicken, nicht die Kante.');
            return;
          }
          const locks = copy ? [] : handleLocks(current.definition, model, handle);
          if (locks.length) {
            current.onStatus(`Gesperrt durch die Formel ${locks.map(item => `${item.path} = ${item.formula}`).join(', ')}.`);
            setOverlay({ label: { at: handle.position, text: `${handle.measure?.label ?? handle.label}: ${locks[0]!.formula}`, locked: true } });
            return;
          }
          let side = cross(cameraDirection, handle.axis);
          if (length(side) < 1e-6) side = { x: 1, y: 0, z: 0 };
          const normal = normalize(cross(handle.axis, normalize(side)));
          drag.current = {
            kind: 'pushpull', handle, origin: hit.point!, startDefinition: current.definition, startResolved: model,
            candidates: inferenceCandidates(model, exclude), plane: { origin: hit.point!, normal },
            delta: 0, moved: false, pointer, copy,
          };
          current.onStatus(copy
            ? 'Neuer Körper: Lage anklicken oder Maß eintippen.'
            : 'Neue Lage anklicken oder Maß eintippen und Enter. Strg (auch nachträglich) erzeugt einen neuen Körper.');
          return;
        }
        if (active === 'move') {
          const { snap } = snapFor(event);
          const start = snap?.point;
          if (!start) { current.onStatus('Bezugspunkt aus der Inferenz wählen.'); return; }
          const targets = targetsFor(solid);
          if (!targets.bodies.length && !targets.children.length) { current.onStatus('Erst etwas auswählen.'); return; }
          const previewIds = solidIdsForTargets(model, targets);
          drag.current = {
            kind: 'move', targets, previewIds, start, startDefinition: current.definition, startResolved: model,
            candidates: inferenceCandidates(model, exclude), delta: { x: 0, y: 0, z: 0 }, moved: false, pointer, exclude, copy: false,
          };
          current.onStatus(`${snap.label}: Zielpunkt klicken. Pfeiltasten oder Umschalt sperren die Achse, Strg kopiert.`);
          return;
        }
        if (active === 'rotate') {
          const { snap } = snapFor(event);
          if (!snap) { current.onStatus('Drehpunkt aus der Inferenz wählen.'); return; }
          const axisName = solid ? (axisOf(hit.normal ?? { x: 0, y: 1, z: 0 }, 0.9) ?? 'y') : 'y';
          const axis = AXIS_VECTORS[axisName];
          const targets = targetsFor(solid);
          if (!targets.bodies.length && !targets.children.length) { current.onStatus('Erst etwas auswählen.'); return; }
          drag.current = {
            kind: 'rotate', targets, previewIds: solidIdsForTargets(model, targets), phase: 'from', pivot: snap.point, axis, home: axis,
            from: { x: 1, y: 0, z: 0 }, startDefinition: current.definition, startResolved: model, angle: 0, moved: false, pointer, copy: false,
          };
          current.onStatus(`${snap.label}: Startpunkt der Drehung klicken. Pfeiltasten wählen die Achse.`);
          return;
        }
      }
      if (active === 'interact') {
        const hit = pick(event.clientX, event.clientY);
        if (hit.solid) current.onInteract(hit.solid);
        return;
      }
      if (current.readOnly && active !== 'tape') return;
      const sketch = draw.current;
      if (active === 'tape') {
        const { snap } = snapFor(event, sketch?.kind === 'tape' && !sketch.done ? sketch.from : undefined);
        if (!snap) return;
        if (sketch?.kind === 'tape' && !sketch.done) {
          sketch.cursor = snap.point; sketch.done = true;
          const distance = length(sub(snap.point, sketch.from));
          current.onReadout({ label: 'Abstand', value: formatMm(distance) });
          current.onStatus(`Abstand ${formatMm(distance)} mm`);
          updateDrawOverlay();
        } else {
          draw.current = { kind: 'tape', from: snap.point };
          updateDrawOverlay(snap);
        }
        return;
      }
      if (active === 'split') {
        if (current.readOnly) return;
        if (sketch?.kind === 'split') {
          // Second click always places the cut. Direction only changes via Pfeiltasten —
          // face-normal switching stole Stärke cuts when the pointer hit a side face.
          const message = finishSplit(sketch);
          if (message) current.onStatus(message);
          return;
        }
        const hit = pick(event.clientX, event.clientY);
        if (!hit.solid) { current.onStatus('Quader oder rechteckige Platte anklicken.'); return; }
        const draft = splitDraft(hit.solid, hit.normal ?? { x: 0, y: 1, z: 0 });
        if ('error' in draft) { current.onStatus(draft.error); return; }
        draw.current = draft;
        current.onStatus(splitStatus(draft));
        updateDrawOverlay();
        return;
      }
      if (active === 'rect') {
        if (sketch?.kind === 'rect') {
          const plane = { origin: sketch.anchor, normal: sketch.normal };
          const { snap } = snapFor(event, sketch.anchor, plane);
          if (snap) {
            const point = inPlane(snap.point, plane);
            const v = cross(sketch.normal, sketch.u);
            const span = sub(point, sketch.anchor);
            const locked = squareLockedExtents(dot(span, sketch.u), dot(span, v), {
              shift: event.shiftKey,
              tolerance: SNAP_PIXELS * pixelMm(point),
            });
            sketch.opposite = add(sketch.anchor, add(scale(sketch.u, locked.along), scale(v, locked.across)));
            sketch.square = locked.square;
          }
          const message = finishRect(sketch, undefined, undefined, false);
          if (message) current.onStatus(message);
          return;
        }
        const { snap } = snapFor(event);
        if (!snap) return;
        const normal = drawingNormal(snap.kind === 'face' ? snap.normal : undefined);
        draw.current = { kind: 'rect', anchor: snap.point, normal, homeNormal: normal, u: planeAxes(normal) };
        current.onStatus('Gegenecke klicken oder Maße eintippen. Pfeiltasten sperren die Ebene (senkrecht = in die Luft).');
        updateDrawOverlay(snap);
        return;
      }
      if (active === 'circle') {
        if (sketch?.kind === 'circle') {
          const plane = { origin: sketch.centre, normal: sketch.normal };
          const { snap } = snapFor(event, sketch.centre, plane);
          if (snap) sketch.cursor = inPlane(snap.point, plane);
          const radius = sketch.cursor ? length(sub(sketch.cursor, sketch.centre)) : 0;
          const message = finishCircle(sketch, radius, sketch.segments, false);
          if (message) current.onStatus(message);
          return;
        }
        const { snap } = snapFor(event);
        if (!snap) return;
        const normal = drawingNormal(snap.kind === 'face' ? snap.normal : undefined);
        draw.current = { kind: 'circle', centre: snap.point, normal, homeNormal: normal };
        current.onStatus('Radius klicken oder eintippen. Pfeiltasten sperren die Ebene.');
        updateDrawOverlay(snap);
        return;
      }
      if (active === 'polygon') {
        if (sketch?.kind === 'ngon') {
          const plane = { origin: sketch.centre, normal: sketch.normal };
          const { snap } = snapFor(event, sketch.centre, plane);
          if (snap) sketch.cursor = inPlane(snap.point, plane);
          const radius = sketch.cursor ? length(sub(sketch.cursor, sketch.centre)) : 0;
          const message = finishNgon(sketch, radius, false);
          if (message) current.onStatus(message);
          return;
        }
        const { snap } = snapFor(event);
        if (!snap) return;
        const normal = drawingNormal(snap.kind === 'face' ? snap.normal : undefined);
        draw.current = { kind: 'ngon', centre: snap.point, normal, homeNormal: normal, sides: polygonSides.current };
        current.onStatus(`${polygonSides.current}-Eck: Radius klicken. Pfeiltasten sperren die Ebene.`);
        updateDrawOverlay(snap);
        return;
      }
      if (active === 'line') {
        if (sketch?.kind === 'line') {
          const plane = { origin: sketch.points[0]!, normal: sketch.normal };
          const first = screenOf(sketch.points[0]!);
          if (sketch.points.length >= 3 && Math.hypot(first.x - event.clientX, first.y - event.clientY) <= SNAP_PIXELS) { finishLine(sketch); return; }
          const { snap } = snapFor(event, sketch.points[sketch.points.length - 1], plane);
          if (snap) sketch.points.push(inPlane(snap.point, plane));
          updateDrawOverlay(snap);
          return;
        }
        const { snap } = snapFor(event);
        if (!snap) return;
        const normal = drawingNormal(snap.kind === 'face' ? snap.normal : undefined);
        draw.current = { kind: 'line', normal, homeNormal: normal, points: [snap.point] };
        current.onStatus('Nächsten Punkt klicken. Pfeiltasten sperren die Ebene. Schließen erzeugt die Fläche.');
        updateDrawOverlay(snap);
        return;
      }
      if (active === 'beam') {
        const { snap } = snapFor(event, sketch?.kind === 'beam' ? sketch.from : undefined);
        if (!snap) return;
        if (sketch?.kind === 'beam') {
          const message = finishBeam(sketch.from, snap.point, false);
          if (message) current.onStatus(message);
          return;
        }
        draw.current = { kind: 'beam', from: snap.point };
        current.onStatus('Ende klicken oder Länge eintippen. Esc beendet.');
        updateDrawOverlay(snap);
      }
    }

    function onCancel(event: PointerEvent) {
      down = undefined;
      if (view.current.controls) view.current.controls.enabled = true;
      latest.current.onMarquee(undefined);
      if (drag.current) endDrag(true);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    }

    function onKey(event: KeyboardEvent) {
      const state = drag.current;
      if (event.key === 'Escape') {
        if (state) { event.preventDefault(); event.stopImmediatePropagation(); endDrag(true); return; }
        if (draw.current) { event.preventDefault(); event.stopImmediatePropagation(); draw.current = undefined; setOverlay({}); latest.current.onStatus(undefined); }
        return;
      }
      // Latch Ctrl/Meta on keydown so a tap without pointer-move still enables Neu/Kopie.
      if ((event.key === 'Control' || event.key === 'Meta') && state && 'copy' in state && !event.repeat) {
        latchCopy(state);
        return;
      }
      if (state?.kind === 'move' && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const next = axisFromArrowKey(event.key);
        state.shiftLocked = false;
        state.axis = next && state.axis !== next ? next : undefined;
        return;
      }
      if (state?.kind === 'rotate' && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const axis = axisFromArrowKey(event.key) ?? 'y';
        state.axis = axisOf(state.axis) === axis ? state.home : AXIS_VECTORS[axis];
        state.from = sub(rayPlane({ origin: add(state.pivot, scale(state.axis, 1000)), direction: scale(state.axis, -1) }, state.pivot, state.axis) ?? state.pivot, state.pivot);
        if (length(state.from) < 1e-6) state.from = axis === 'y' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        return;
      }
      const sketch = draw.current;
      if (sketch?.kind === 'split' && event.key.startsWith('Arrow') && !isTypingTarget(event.target)) {
        event.preventDefault();
        const solid = latest.current.resolved?.solids.find(item => item.body === sketch.body && !item.path.length);
        if (!solid || (solid.kind !== 'box' && solid.kind !== 'sheet')) return;
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
        const draft = splitDraftFromOption(solid, sketch.options, sketch.option + step, sketch.cut);
        draw.current = draft;
        latest.current.onStatus(splitStatus(draft));
        updateDrawOverlay();
        return;
      }
      if (
        sketch
        && (sketch.kind === 'rect' || sketch.kind === 'circle' || sketch.kind === 'ngon' || sketch.kind === 'line')
        && event.key.startsWith('Arrow')
        && !isTypingTarget(event.target)
      ) {
        const next = axisFromArrowKey(event.key);
        if (!next) return;
        event.preventDefault();
        const lock = sketch.planeLock === next ? undefined : next;
        sketch.planeLock = lock;
        sketch.normal = lock ? drawingPlaneNormal(lock) : sketch.homeNormal;
        if (sketch.kind === 'rect') sketch.u = planeAxes(sketch.normal);
        latest.current.onStatus(lock
          ? `Ebene: ${drawingPlaneLockLabel(lock)}. Nochmal dieselbe Pfeiltaste löst.`
          : 'Ebene gelöst — wieder Boden oder Startfläche.');
        updateDrawOverlay();
        return;
      }
      if (sketch?.kind === 'line' && (event.key === 'Enter' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        if (event.key === 'Enter' && sketch.points.length >= 3) finishLine(sketch);
        if (event.key === 'Backspace') { sketch.points.pop(); if (!sketch.points.length) draw.current = undefined; updateDrawOverlay(); }
      }
    }

    function onLeave() {
      updateHover({});
      if (!drag.current && !draw.current) setOverlay({});
    }
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    target.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    return () => {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
      target.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
    };
    // Live tool/definition/resolved/selection live in latest + handlesRef/selectedIdsRef/view.
  }, [gl.domElement]);

  useEffect(() => { invalidate(); }, [overlay, hover, resolved, selection, multi, invalidate]);

  const colors = useMemo(() => new Map(materials.map(material => [material.key, material.color])), [materials]);
  const showLabels = !readOnly && tool === 'select' && !drag.current;
  const labelHandles = useMemo(() => {
    const seen = new Set<string>();
    return handles.filter(handle => {
      if (!selectedIds.has(handle.solid) || !handle.measure?.path || handle.kind === 'rotation') return false;
      const key = `${handle.solid}:${handle.measure.path.join('.')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [handles, selectedIds]);

  return <>
    <ReferenceGrid />
    {surrounding && <group scale={MM}>
      {surrounding.resolved.solids.filter(solid => !surrounding.hide(solid)).map(solid =>
        <SolidMesh workspaceId={props.workspaceId} assets={props.assets} key={`ctx:${solid.id}`} solid={solid} color={colors.get(solid.material) ?? FALLBACK_COLOR} dimmed />)}
    </group>}
    <group scale={MM}>
      <group ref={model} matrixAutoUpdate={false} matrix={frameMatrix}>
        {resolved?.solids.map(solid => <SolidMesh workspaceId={props.workspaceId} assets={props.assets} key={solid.id} solid={solid} color={colors.get(solid.material) ?? FALLBACK_COLOR}
          selected={selectedIds.has(solid.id)} hovered={hover.solid === solid.id}
          register={object => { if (object) meshes.current.set(solid.id, object); else meshes.current.delete(solid.id); }} />)}
        {hover.face && <FaceOutline solid={hover.face.solid} side={hover.face.side} edge={hover.face.edge} locked={!!hover.locked} />}
        {overlay.lines?.map((line, index) => <Line key={index} points={line.points.map(point => [point.x, point.y, point.z] as [number, number, number])}
          color={line.color} lineWidth={line.width ?? 1.5} dashed={line.dashed} dashSize={20} gapSize={12} depthTest={false} renderOrder={5} />)}
        {overlay.snap && <Html portal={props.overlay as MutableRefObject<HTMLElement>} position={[overlay.snap.point.x, overlay.snap.point.y, overlay.snap.point.z]} zIndexRange={[20, 10]}
          style={{ pointerEvents: 'none' }}>
          <span className={`snap-marker snap-${overlay.snap.kind}`} data-testid="designer-snap"
            style={overlay.snap.axis ? { color: AXIS_COLORS[overlay.snap.axis] } : undefined}>
            <i />
            <span className="snap-label">{overlay.snap.label}</span>
          </span>
        </Html>}
        {overlay.pivot && <mesh position={[overlay.pivot.x, overlay.pivot.y, overlay.pivot.z]} renderOrder={6}>
          <sphereGeometry args={[12, 12, 8]} /><meshBasicMaterial color={HIGHLIGHT} depthTest={false} />
        </mesh>}
        {overlay.label && <Html portal={props.overlay as MutableRefObject<HTMLElement>} position={[overlay.label.at.x, overlay.label.at.y, overlay.label.at.z]} zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
          <span className={overlay.label.locked ? 'model-live-label locked' : 'model-live-label'} data-testid="designer-live-label">
            {overlay.label.locked && <LockIcon />}{overlay.label.text}
          </span>
        </Html>}
        {showLabels && labelHandles.map(handle => {
          const locks = resolved ? handleLocks(definition, resolved, handle) : [];
          const offset = add(handle.position, scale(handle.axis, 4 * pixelMm(handle.position)));
          return <Html portal={props.overlay as MutableRefObject<HTMLElement>} key={handle.id} position={[offset.x, offset.y, offset.z]} zIndexRange={[15, 5]}>
            <button type="button" className={locks.length ? 'model-dimension locked' : 'model-dimension'} data-testid={`designer-dimension-${handle.name}`}
              title={locks.length ? `Gesperrt: ${locks.map(item => item.formula).join(', ')}` : 'Als Attribut zeigen'}
              onPointerDown={event => event.stopPropagation()} onClick={() => props.onDimension(handle)}>
              {locks.length > 0 && <LockIcon />}{handle.measure!.label} {formatMm(handle.measure!.value)}{locks.length ? ` = ${locks[0]!.formula}` : ''}
            </button>
          </Html>;
        })}
      </group>
    </group>
  </>;
}

function LockIcon() {
  return <svg className="lock-icon" viewBox="0 0 12 12" aria-label="gesperrt" role="img">
    <rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor" />
    <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>;
}

/** Floor grid with red, green and blue axes through the origin. */
function ReferenceGrid() {
  return <group>
    <gridHelper args={[10, 20, '#b9c2c8', '#dde2e6']} position={[0, 0.0005, 0]} raycast={() => null} />
    <Line points={[[0, 0.001, 0], [5, 0.001, 0]]} color={AXIS_COLORS.x} lineWidth={1.5} />
    <Line points={[[0, 0.001, 0], [0, 0.001, 5]]} color={AXIS_COLORS.z} lineWidth={1.5} />
    <Line points={[[0, 0, 0], [0, 3, 0]]} color={AXIS_COLORS.y} lineWidth={1.5} />
    <Line points={[[0, 0.001, 0], [-5, 0.001, 0]]} color={AXIS_COLORS.x} lineWidth={1} dashed dashSize={0.05} gapSize={0.05} />
    <Line points={[[0, 0.001, 0], [0, 0.001, -5]]} color={AXIS_COLORS.z} lineWidth={1} dashed dashSize={0.05} gapSize={0.05} />
  </group>;
}

const geometryCache = new Map<string, { geometry: BufferGeometry; edges: EdgesGeometry; users: number }>();
function acquireGeometry(solid: ResolvedSolid) {
  const { id: _id, path: _path, label: _label, ...shape } = solid;
  const key = JSON.stringify(shape);
  let entry = geometryCache.get(key);
  if (!entry) {
    const geometry = buildSolidGeometry(solid);
    entry = { geometry, edges: new EdgesGeometry(geometry, 25), users: 0 };
    geometryCache.set(key, entry);
  }
  entry.users++;
  return { key, entry };
}
function releaseGeometry(key: string) {
  const entry = geometryCache.get(key);
  if (!entry) return;
  entry.users--;
  if (entry.users <= 0) {
    entry.geometry.dispose();
    entry.edges.dispose();
    geometryCache.delete(key);
  }
}

function SolidMesh({ workspaceId, assets, solid, color, selected, hovered, dimmed, register }: {
  workspaceId: string; assets: readonly Asset[]; solid: ResolvedSolid; color: string; selected?: boolean; hovered?: boolean; dimmed?: boolean; register?: (object: Object3D | null) => void;
}) {
  const [shared, setShared] = useState<{ key: string; geometry: BufferGeometry; edges: EdgesGeometry }>();
  const shapeKey = useMemo(() => {
    const { id: _id, path: _path, label: _label, ...shape } = solid;
    return JSON.stringify(shape);
  }, [solid]);
  useEffect(() => {
    const { key, entry } = acquireGeometry(solid);
    setShared({ key, geometry: entry.geometry, edges: entry.edges });
    return () => releaseGeometry(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);
  const material = useMemo(() => new MeshStandardMaterial({
    color, roughness: 0.8, metalness: 0,
    transparent: !!dimmed || !!solid.displayOnly, opacity: dimmed ? 0.18 : solid.displayOnly ? 0.7 : 1, depthWrite: !dimmed,
    emissive: selected ? HIGHLIGHT : hovered ? '#6f8f8a' : '#000000', emissiveIntensity: selected ? 0.38 : hovered ? 0.18 : 0,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  }), [color, dimmed, selected, hovered, solid.displayOnly]);
  useEffect(() => () => material.dispose(), [material]);
  if (!shared) return null;
  return <group ref={register} userData={{ solidId: solid.id }}>
    {solid.kind === 'box' && solid.assetId && <WorkspaceMesh workspaceId={workspaceId} asset={assets.find(asset => asset.id === solid.assetId)} solid={solid} />}
    <mesh geometry={shared.geometry} material={material} visible={!(solid.kind === 'box' && solid.assetId)} userData={{ solidId: solid.id }} castShadow={!dimmed} receiveShadow
      raycast={dimmed ? () => null : undefined} dispose={null} />
    <lineSegments geometry={shared.edges} raycast={() => null} dispose={null}>
      <lineBasicMaterial color={selected ? '#9a5b12' : '#33434e'} transparent opacity={dimmed ? 0.15 : 0.55} />
    </lineSegments>
  </group>;
}

function FaceOutline({ solid, side, edge, locked }: { solid: ResolvedSolid; side: PartFaceSide; edge?: Handle; locked: boolean }) {
  // Sheet rim: draw the full thickness quad, not the mid-plane segment (that looked like a lone line).
  let points: Vec3[] | undefined;
  if (edge?.segment && solid.kind === 'sheet') {
    const mid = solid.thickness / 2;
    const along = scale(quatAxes(solid.rotation).z, mid);
    const [a, b] = edge.segment;
    const frontA = sub(a, along), frontB = sub(b, along);
    const backA = add(a, along), backB = add(b, along);
    points = [frontA, frontB, backB, backA, frontA];
  } else {
    points = edge?.segment ? [edge.segment[0], edge.segment[1]] : faceLoop(solid, side);
  }
  if (!points) return null;
  return <Line points={points.map(point => [point.x, point.y, point.z] as [number, number, number])} color={locked ? '#963d2b' : HIGHLIGHT}
    lineWidth={edge ? 4 : 3} depthTest={false} renderOrder={4} />;
}
