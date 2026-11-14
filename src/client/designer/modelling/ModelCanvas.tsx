import { Component, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import {
  EdgesGeometry, Matrix4, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3,
  type BufferGeometry, type Group, type Intersection, type Object3D,
} from 'three';
import type { PartDefinition, PartFaceSide, PartMaterial } from '../../../shared/parts/definition.js';
import {
  addBeam, addFaceFromRect, addSheetFromOutline, copySelection, handleLocks, moveSelection, moveVertex, pushPullFace, rotateSelection,
  setHandleMeasure, type AddResult, type EditResult, type SelectionTargets,
} from '../../../shared/parts/directEdit.js';
import { BOX_SIDE_SLOTS, SHEET_SIDE_SLOTS, buildSolidGeometry } from '../../../shared/parts/geometry.js';
import { handleForPick, partHandles, type Handle } from '../../../shared/parts/handles.js';
import {
  AXIS_COLORS, AXIS_VECTORS, angleAbout, axisOf, inferenceCandidates, pointOnAxis, rayPlane, snapAlongAxis, snapAngle, snapPoint,
  type AxisName, type InferenceCandidates, type Ray, type Snap,
} from '../../../shared/parts/inference.js';
import { add, boundsOf, cross, dot, length, normalize, scale, sub, type RigidTransform, type Vec3 } from '../../../shared/parts/math.js';
import { solidFace, solidVertices, type ResolvedPart, type ResolvedSolid } from '../../../shared/parts/resolve.js';
import type { StageBounds } from '../../stage/cameraFraming.js';
import { StageCanvas } from '../../stage/StageCanvas.js';
import type { DesignerSelection } from '../draft.js';
import { resolvedGeometryKey } from '../geometryCache.js';
import { sameSelection, solidSelection } from '../views.js';
import { MODEL_TOOLS, type ModelToolId } from './tools.js';

const MM = 0.001;
const FALLBACK_COLOR = '#c9cfd2';
const SNAP_PIXELS = 10;
const CLICK_PIXELS = 4;
const HIGHLIGHT = '#e59a2f';

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

class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="muted designer-preview-failed" role="status">Die 3D-Ansicht ist in diesem Browser nicht verfügbar. Formeln, Optionen und die Ansichten darunter bleiben nutzbar.</p>
      : this.props.children;
  }
}

/** The Designer's modelling view: the part on the stage canvas, picked, drawn and edited with the tools. */
export function ModelCanvas(props: ModelCanvasProps) {
  const { resolved, frameBounds } = props;
  const container = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
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
    <CanvasBoundary>
      <div className="designer-canvas"><StageCanvas aria-label={props.label} theme="studio" quality="simple" bounds={frameBounds} camera={camera}
        cameraRevision={props.frameRevision} controls={{ buttons: 'editor' }} ground="none">
        <ModelScene {...props} container={container} overlay={overlay} />
      </StageCanvas><div ref={overlay} className="model-overlay" /></div>
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
  | { kind: 'move'; targets: SelectionTargets; vertex?: Handle; start: Vec3; startDefinition: PartDefinition; startResolved: ResolvedPart; candidates: InferenceCandidates; axis?: AxisName; shiftLocked?: boolean; delta: Vec3; moved: boolean; pointer: { x: number; y: number }; exclude: Set<string>; copy: boolean }
  | { kind: 'rotate'; targets: SelectionTargets; phase: 'from' | 'to'; pivot: Vec3; axis: Vec3; home: Vec3; from: Vec3; startDefinition: PartDefinition; startResolved: ResolvedPart; angle: number; moved: boolean; pointer: { x: number; y: number } }
  | { kind: 'pushpull'; handle: Handle; origin: Vec3; startDefinition: PartDefinition; startResolved: ResolvedPart; candidates: InferenceCandidates; plane: { origin: Vec3; normal: Vec3 }; delta: number; moved: boolean; pointer: { x: number; y: number } }
  | { kind: 'window'; x0: number; y0: number; x1: number; y1: number };

type Draw =
  | { kind: 'rect'; anchor: Vec3; normal: Vec3; u: Vec3; opposite?: Vec3 }
  | { kind: 'polygon'; normal: Vec3; points: Vec3[]; cursor?: Vec3 }
  | { kind: 'beam'; from: Vec3; cursor?: Vec3 }
  | { kind: 'tape'; from: Vec3; cursor?: Vec3; done?: boolean };

/** What the value box changes after a gesture ended: the step is redone from its start with the typed value. */
type LastStep =
  | { kind: 'move'; target: Drag & { kind: 'move' }; direction: Vec3 }
  | { kind: 'rotate'; target: Drag & { kind: 'rotate' } }
  | { kind: 'pushpull'; target: Drag & { kind: 'pushpull' } }
  | { kind: 'rect'; startDefinition: PartDefinition; draw: Draw & { kind: 'rect' }; key: string }
  | { kind: 'beam'; startDefinition: PartDefinition; from: Vec3; direction: Vec3; key: string };

function planeAxes(normal: Vec3): Vec3 {
  const n = normalize(normal);
  if (Math.abs(n.x) > 0.9) return { x: 0, y: 0, z: 1 };
  return { x: 1, y: 0, z: 0 };
}

/** The part axis a face normal stands on, or the floor normal for a slanted face. */
function drawingNormal(normal: Vec3 | undefined): Vec3 {
  const axis = normal && axisOf(normal, 0.999);
  if (!axis || !normal) return { x: 0, y: 1, z: 0 };
  const sign = Math.sign(dot(normal, AXIS_VECTORS[axis]));
  return scale(AXIS_VECTORS[axis], sign || 1);
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
function ModelScene(props: ModelCanvasProps & { container: MutableRefObject<HTMLDivElement | null>; overlay: MutableRefObject<HTMLDivElement | null> }) {
  const { resolved, definition, selection, multi, tool, readOnly, surrounding, frame, materials } = props;
  const gl = useThree(state => state.gl);
  const cameraObject = useThree(state => state.camera);
  const controls = useThree(state => state.controls) as ({ enabled: boolean } | null);
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const model = useRef<Group>(null);
  const [hover, setHover] = useState<Hover>({});
  const [overlay, setOverlay] = useState<Overlay>({});
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number; crossing: boolean }>();
  const latest = useRef(props); latest.current = props;
  const drag = useRef<Drag | undefined>(undefined);
  const draw = useRef<Draw | undefined>(undefined);
  const last = useRef<LastStep | undefined>(undefined);
  const lastClick = useRef<{ time: number; solid?: string }>({ time: 0 });
  const meshes = useRef(new Map<string, Object3D>());

  const handles = useMemo(() => resolved ? partHandles(definition, resolved) : [], [definition, resolved]);
  const selectedIds = useMemo(() => selectedSolidIds(resolved, selection, multi), [resolved, selection, multi]);
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
    raycaster.setFromCamera(ndc, cameraObject);
    const origin = toLocal(raycaster.ray.origin);
    const ahead = toLocal(raycaster.ray.origin.clone().add(raycaster.ray.direction));
    return { ray: { origin, direction: normalize(sub(ahead, origin)) }, raycaster };
  }

  function pick(clientX: number, clientY: number, exclude?: ReadonlySet<string>) {
    const { ray, raycaster } = rayAt(clientX, clientY);
    const objects = [...meshes.current.values()];
    const hits: Intersection[] = raycaster.intersectObjects(objects, false);
    for (const hit of hits) {
      const id = hit.object.userData.solidId as string | undefined;
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
    const world = toWorld(point);
    let span: number;
    if (cameraObject instanceof OrthographicCamera) span = (cameraObject.top - cameraObject.bottom) / cameraObject.zoom / size.height;
    else {
      const distance = cameraObject.position.distanceTo(world);
      const fov = (cameraObject as PerspectiveCamera).fov ?? 45;
      span = 2 * distance * Math.tan(fov * Math.PI / 360) / size.height;
    }
    return span / MM;
  }

  function screenOf(point: Vec3): { x: number; y: number } {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = toWorld(point).project(cameraObject);
    return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  }

  /** Pixels from the canvas's top-left corner, so the readout stays right when the page scrolls without a redraw. */
  function canvasOf(point: Vec3): { x: number; y: number } {
    const { width, height } = gl.domElement.getBoundingClientRect();
    const ndc = toWorld(point).project(cameraObject);
    return { x: (ndc.x + 1) / 2 * width, y: (1 - ndc.y) / 2 * height };
  }

  // Readout of projected handle points for browser tests, refreshed with every drawn frame.
  const readout = useRef('');
  useFrame(() => {
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
    if (state.vertex) return moveVertex(state.startDefinition, state.startResolved, state.vertex, delta);
    return copy
      ? copySelection(state.startDefinition, state.startResolved, state.targets, delta)
      : moveSelection(state.startDefinition, state.startResolved, state.targets, delta);
  }
  function rotateEdit(state: Drag & { kind: 'rotate' }, angle: number): EditResult {
    return rotateSelection(state.startDefinition, state.startResolved, state.targets, state.axis, angle, state.pivot);
  }
  const moveLabel = (delta: Vec3) => `Abstand ${formatMm(length(delta))} mm`;

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
        if (sketch?.kind === 'beam') {
          const direction = sketch.cursor && length(sub(sketch.cursor, sketch.from)) > 0 ? normalize(sub(sketch.cursor, sketch.from)) : { x: 1, y: 0, z: 0 };
          return finishBeam(sketch.from, add(sketch.from, scale(direction, first)), false);
        }
        if (sketch?.kind === 'polygon' && sketch.points.length) {
          const from = sketch.points[sketch.points.length - 1]!;
          const direction = sketch.cursor && length(sub(sketch.cursor, from)) > 0 ? normalize(sub(sketch.cursor, from)) : { x: 1, y: 0, z: 0 };
          sketch.points.push(add(from, scale(direction, first)));
          updateDrawOverlay();
          return undefined;
        }
        if (running?.kind === 'pushpull') {
          const outcome = running.handle.measure
            ? setHandleMeasure(running.startDefinition, running.startResolved, running.handle, first)
            : pushPullFace(running.startDefinition, running.startResolved, running.handle, first);
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
          const { handle, startDefinition, startResolved } = step.target;
          const outcome = handle.measure
            ? setHandleMeasure(startDefinition, startResolved, handle, first)
            : pushPullFace(startDefinition, startResolved, handle, first);
          if (!outcome.ok) return outcome.message;
          current.onCommit({ definition: outcome.definition, label: 'Drücken/Ziehen' }, true);
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
    const along = width === undefined ? du : width * (Math.sign(du) || 1);
    const across = depth === undefined ? dv : depth * (Math.sign(dv) || 1);
    const opposite = add(sketch.anchor, add(scale(sketch.u, along), scale(v, across)));
    const start = base ?? current.definition;
    const outcome = addFaceFromRect(start, { corner: sketch.anchor, opposite, u: sketch.u, normal: sketch.normal }, current.defaultMaterials.sheet);
    if (!outcome.ok) return outcome.message;
    current.onCommit({ definition: outcome.definition, select: { kind: 'body', key: outcome.key }, label: 'Rechteck' }, amend);
    last.current = { kind: 'rect', startDefinition: start, draw: { ...sketch, opposite }, key: outcome.key };
    draw.current = undefined;
    setOverlay({});
    current.onReadout({ label: 'Maße', value: `${formatMm(Math.abs(along))};${formatMm(Math.abs(across))}` });
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

  function finishPolygon(sketch: Draw & { kind: 'polygon' }) {
    const current = latest.current;
    const outcome = addSheetFromOutline(current.definition, { points: sketch.points, normal: sketch.normal }, current.defaultMaterials.sheet);
    if (!outcome.ok) { current.onStatus(outcome.message); return; }
    current.onCommit({ definition: outcome.definition, select: { kind: 'body', key: outcome.key }, label: current.tool === 'line' ? 'Linie' : 'Vieleck' }, false);
    draw.current = undefined;
    setOverlay({});
  }

  function endDrag(cancel: boolean, outcome?: EditResult) {
    const state = drag.current;
    if (!state) return;
    drag.current = undefined;
    if (state.kind === 'window') { setOverlay({}); return; }
    if (controls) controls.enabled = true;
    const current = latest.current;
    if (cancel || !state.moved && !outcome) {
      if (state.moved) current.onCancel();
      setOverlay({});
      return;
    }
    const finalOutcome = outcome ?? (state.kind === 'move' ? moveEdit(state, state.delta)
      : state.kind === 'rotate' ? rotateEdit(state, state.angle)
        : pushPullFace(state.startDefinition, state.startResolved, state.handle, state.delta));
    if (!finalOutcome.ok) {
      current.onStatus(finalOutcome.message);
      current.onCancel();
      setOverlay({});
      return;
    }
    const label = state.kind === 'move' ? 'Verschieben' : state.kind === 'rotate' ? 'Drehen' : 'Drücken/Ziehen';
    current.onCommit({ definition: finalOutcome.definition, label }, false);
    if (state.kind === 'move') last.current = { kind: 'move', target: state, direction: length(state.delta) > 0 ? normalize(state.delta) : { x: 1, y: 0, z: 0 } };
    else if (state.kind === 'rotate') last.current = { kind: 'rotate', target: state };
    else last.current = { kind: 'pushpull', target: state };
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
      label = { at: c, text: `${formatMm(Math.abs(du))} × ${formatMm(Math.abs(dv))} mm` };
      latest.current.onReadout({ label: 'Maße', value: `${formatMm(Math.abs(du))};${formatMm(Math.abs(dv))}` });
    }
    if (sketch.kind === 'polygon') {
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

    function snapFor(event: PointerEvent, from?: Vec3, plane?: { origin: Vec3; normal: Vec3 }, exclude?: ReadonlySet<string>) {
      const hit = pick(event.clientX, event.clientY, exclude);
      const base = hit.solid ? hit.point! : rayPlane(hit.ray, plane?.origin ?? { x: 0, y: 0, z: 0 }, plane?.normal ?? { x: 0, y: 1, z: 0 }) ?? hit.ray.origin;
      const tolerance = SNAP_PIXELS * pixelMm(base);
      const candidates = inferenceCandidates(latest.current.resolved ?? { solids: [] }, exclude);
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
          setMarquee({
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
          const outcome = pushPullFace(state.startDefinition, state.startResolved, state.handle, delta);
          const measure = state.handle.measure;
          const text = measure ? `${measure.label} ${formatMm(measure.value + delta)} mm` : `${formatMm(delta)} mm`;
          if (outcome.ok) {
            state.delta = delta;
            current.onStatus(undefined);
            current.onPreview(outcome.definition);
            current.onReadout({ label: measure?.label ?? 'Abstand', value: formatMm(measure ? measure.value + delta : delta) });
          } else current.onStatus(outcome.message);
          const tip = add(state.handle.position, scale(state.handle.axis, state.delta));
          setOverlay({ ...(snap ? { snap } : {}), label: { at: tip, text, locked: !outcome.ok }, lines: [{ points: [state.handle.position, tip], color: '#b77c37', dashed: true }] });
          return;
        }
        if (state.kind === 'move') {
          const plane = { origin: state.start, normal: { x: 0, y: 1, z: 0 } };
          let point: Vec3;
          let snap: Snap | undefined;
          if (event.shiftKey) {
            const hinted = snapFor(event, state.start, undefined, state.exclude).snap;
            if (hinted?.axis) { state.axis = hinted.axis; state.shiftLocked = true; }
          } else if (state.shiftLocked) {
            state.axis = undefined;
            state.shiftLocked = false;
          }
          if (state.axis) {
            point = pointOnAxis(rayAt(event.clientX, event.clientY).ray, state.start, AXIS_VECTORS[state.axis], 1, event.altKey);
          } else {
            const found = snapFor(event, state.start, undefined, state.exclude);
            snap = found.snap;
            point = found.snap?.point ?? state.start;
            if (!found.hit.solid && !found.snap?.solid && found.snap?.kind !== 'axis') point = inPlane(point, plane);
          }
          state.copy = event.ctrlKey || event.metaKey;
          const delta = sub(point, state.start);
          const outcome = moveEdit(state, delta);
          if (outcome.ok) { state.delta = delta; current.onStatus(undefined); current.onPreview(outcome.definition); }
          else current.onStatus(outcome.message);
          current.onReadout({ label: state.copy ? 'Kopie' : 'Abstand', value: formatMm(length(delta)) });
          const color = state.axis ? AXIS_COLORS[state.axis] : snap?.axis ? AXIS_COLORS[snap.axis] : '#b77c37';
          setOverlay({ ...(snap ? { snap } : {}), lines: [{ points: [state.start, point], color, dashed: true }], label: { at: point, text: moveLabel(delta) } });
          return;
        }
        const { ray } = rayAt(event.clientX, event.clientY);
        const onPlane = rayPlane(ray, state.pivot, state.axis);
        if (!onPlane) return;
        const angle = snapAngle(angleAbout(state.axis, state.from, sub(onPlane, state.pivot)), event.altKey);
        const outcome = rotateEdit(state, angle);
        if (outcome.ok) { state.angle = angle; current.onStatus(undefined); current.onPreview(outcome.definition); }
        else current.onStatus(outcome.message);
        current.onReadout({ label: 'Winkel', value: `${angle}` });
        const axisName = axisOf(state.axis) ?? 'y';
        setOverlay({ pivot: state.pivot, lines: [{ points: [state.pivot, add(state.pivot, state.from)], color: '#9aa6ad', dashed: true }, { points: [state.pivot, onPlane], color: AXIS_COLORS[axisName] }], label: { at: onPlane, text: `${angle}°` } });
        return;
      }

      const active = current.tool;
      const sketch = draw.current;
      if (active === 'rect' || active === 'line' || active === 'polygon' || active === 'beam' || active === 'tape') {
        if (current.readOnly && active !== 'tape') return;
        const plane = sketch && (sketch.kind === 'rect' || sketch.kind === 'polygon')
          ? { origin: sketch.kind === 'rect' ? sketch.anchor : sketch.points[0]!, normal: sketch.normal } : undefined;
        const from = sketch?.kind === 'rect' ? sketch.anchor : sketch?.kind === 'polygon' ? sketch.points[sketch.points.length - 1] : sketch && 'from' in sketch ? sketch.from : undefined;
        const { snap } = snapFor(event, from, plane);
        if (!snap) return;
        const point = plane ? inPlane(snap.point, plane) : snap.point;
        if (sketch?.kind === 'rect') sketch.opposite = point;
        else if (sketch?.kind === 'polygon') sketch.cursor = point;
        else if (sketch && (sketch.kind === 'beam' || (sketch.kind === 'tape' && !sketch.done))) sketch.cursor = point;
        updateDrawOverlay(snap);
        return;
      }
      if (active === 'pushpull' || active === 'select' || active === 'move' || active === 'rotate' || active === 'interact') {
        const hit = pick(event.clientX, event.clientY);
        if (!hit.solid) { setHover({}); return; }
        const solid = hit.solid;
        if (active === 'pushpull' && !solid.path.length) {
          const handle = handleForPick(handles, solid.id, hit.side!, hit.point!);
          const locks = handle && current.resolved ? handleLocks(current.definition, current.resolved, handle) : [];
          setHover({ solid: solid.id, face: { solid, side: hit.side!, ...(handle?.kind === 'edge' ? { edge: handle } : {}) }, ...(locks.length ? { locked: locks[0]!.formula } : {}) });
        } else setHover({ solid: solid.id });
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
        setMarquee(undefined);
        if (start && Math.hypot(event.clientX - state.x0, event.clientY - state.y0) > CLICK_PIXELS) {
          latest.current.onSelectMany(solidsInWindow(state));
          return;
        }
      }
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_PIXELS) return;
      click(event);
    }

    function click(event: PointerEvent) {
      const current = latest.current;
      const active = current.tool;
      if (active === 'select' || active === 'move' || active === 'rotate' || active === 'pushpull') {
        const running = drag.current;
        if (running && running.kind !== 'window') {
          if (active === 'rotate' && running.kind === 'rotate' && running.phase === 'from') {
            const { ray } = rayAt(event.clientX, event.clientY);
            const onPlane = rayPlane(ray, running.pivot, running.axis);
            if (onPlane) running.from = sub(onPlane, running.pivot);
            if (length(running.from) < 1e-6) running.from = { x: 1, y: 0, z: 0 };
            running.phase = 'to';
            running.moved = false;
            running.pointer = { x: event.clientX, y: event.clientY };
            current.onStatus('Endpunkt der Drehung klicken oder Winkel eintippen.');
            return;
          }
          if (running.kind === 'move') running.copy = event.ctrlKey || event.metaKey;
          endDrag(false);
          return;
        }
        const hit = pick(event.clientX, event.clientY);
        const now = performance.now();
        const solid = hit.solid;
        if (solid && now - lastClick.current.time < 400 && lastClick.current.solid === solid.id) {
          const childKey = childKeyOf(solid);
          if (childKey && !current.readOnly) current.onEnterChild(childKey);
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
          const handle = handleForPick(handles, solid.id, hit.side, hit.point!);
          if (!handle || handle.kind === 'point' || handle.kind === 'rotation') return;
          const locks = handleLocks(current.definition, model, handle);
          if (locks.length) {
            current.onStatus(`Gesperrt durch die Formel ${locks.map(item => `${item.path} = ${item.formula}`).join(', ')}.`);
            setOverlay({ label: { at: handle.position, text: `${handle.measure?.label ?? handle.label}: ${locks[0]!.formula}`, locked: true } });
            return;
          }
          const cameraDirection = normalize(sub(toLocal(cameraObject.getWorldDirection(new Vector3()).add(cameraObject.position)), toLocal(cameraObject.position.clone())));
          let side = cross(cameraDirection, handle.axis);
          if (length(side) < 1e-6) side = { x: 1, y: 0, z: 0 };
          const normal = normalize(cross(handle.axis, normalize(side)));
          drag.current = {
            kind: 'pushpull', handle, origin: hit.point!, startDefinition: current.definition, startResolved: model,
            candidates: inferenceCandidates(model, exclude), plane: { origin: hit.point!, normal }, delta: 0, moved: false, pointer,
          };
          current.onStatus('Neue Lage anklicken oder Maß eintippen und Enter.');
          return;
        }
        if (active === 'move') {
          const { snap } = snapFor(event);
          const nearPoint = handles.find(handle => handle.kind === 'point' && selectedIds.has(handle.solid)
            && Math.hypot(screenOf(handle.position).x - event.clientX, screenOf(handle.position).y - event.clientY) <= SNAP_PIXELS);
          const start = nearPoint ? nearPoint.position : snap?.point ?? hit.point;
          if (!start) return;
          const targets = nearPoint && solid ? { bodies: solid.path.length ? [] : [solid.body], children: childKey ? [childKey] : [] } : targetsFor(solid);
          if (!nearPoint && !targets.bodies.length && !targets.children.length) { current.onStatus('Erst etwas auswählen.'); return; }
          drag.current = {
            kind: 'move', targets, ...(nearPoint ? { vertex: nearPoint } : {}), start, startDefinition: current.definition, startResolved: model,
            candidates: inferenceCandidates(model, nearPoint ? new Set() : exclude), delta: { x: 0, y: 0, z: 0 }, moved: false, pointer, exclude, copy: false,
          };
          current.onStatus('Zielpunkt klicken. Pfeiltasten oder Umschalt sperren die Achse, Strg kopiert.');
          return;
        }
        const axisName = solid ? (axisOf(hit.normal ?? { x: 0, y: 1, z: 0 }, 0.9) ?? 'y') : 'y';
        const axis = AXIS_VECTORS[axisName];
        const snapped = snapFor(event).snap;
        const centre = solid ? (handles.find(handle => handle.solid === solid.id && handle.kind === 'rotation')?.position ?? hit.point!) : (snapped?.point ?? { x: 0, y: 0, z: 0 });
        const pivot = snapped && (snapped.kind === 'endpoint' || snapped.kind === 'midpoint' || snapped.kind === 'origin') ? snapped.point : centre;
        const targets = targetsFor(solid);
        if (!targets.bodies.length && !targets.children.length) { current.onStatus('Erst etwas auswählen.'); return; }
        drag.current = {
          kind: 'rotate', targets, phase: 'from', pivot, axis, home: axis, from: { x: 1, y: 0, z: 0 },
          startDefinition: current.definition, startResolved: model, angle: 0, moved: false, pointer,
        };
        current.onStatus('Startpunkt der Drehung klicken. Pfeiltasten wählen die Achse.');
        return;
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
      if (active === 'rect') {
        if (sketch?.kind === 'rect') {
          const { snap } = snapFor(event, sketch.anchor, { origin: sketch.anchor, normal: sketch.normal });
          if (snap) sketch.opposite = inPlane(snap.point, { origin: sketch.anchor, normal: sketch.normal });
          const message = finishRect(sketch, undefined, undefined, false);
          if (message) current.onStatus(message);
          return;
        }
        const { snap } = snapFor(event);
        if (!snap) return;
        const normal = drawingNormal(snap.kind === 'face' ? snap.normal : undefined);
        draw.current = { kind: 'rect', anchor: snap.point, normal, u: planeAxes(normal) };
        current.onStatus('Gegenecke klicken oder Maße eintippen, zum Beispiel 1200;600.');
        updateDrawOverlay(snap);
        return;
      }
      if (active === 'polygon' || active === 'line') {
        if (sketch?.kind === 'polygon') {
          const plane = { origin: sketch.points[0]!, normal: sketch.normal };
          const first = screenOf(sketch.points[0]!);
          if (sketch.points.length >= 3 && Math.hypot(first.x - event.clientX, first.y - event.clientY) <= SNAP_PIXELS) { finishPolygon(sketch); return; }
          const { snap } = snapFor(event, sketch.points[sketch.points.length - 1], plane);
          if (snap) sketch.points.push(inPlane(snap.point, plane));
          updateDrawOverlay(snap);
          return;
        }
        const { snap } = snapFor(event);
        if (!snap) return;
        draw.current = { kind: 'polygon', normal: drawingNormal(snap.kind === 'face' ? snap.normal : undefined), points: [snap.point] };
        current.onStatus(active === 'line' ? 'Nächsten Punkt klicken. Schließen erzeugt die Fläche.' : 'Weitere Eckpunkte klicken; ersten Punkt oder Enter zum Schließen.');
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
      if (controls) controls.enabled = true;
      setMarquee(undefined);
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
      if (state?.kind === 'move' && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const next: AxisName | undefined = event.key === 'ArrowRight' ? 'x' : event.key === 'ArrowLeft' ? 'z' : event.key === 'ArrowUp' ? 'y' : undefined;
        state.shiftLocked = false;
        state.axis = next && state.axis !== next ? next : undefined;
        return;
      }
      if (state?.kind === 'rotate' && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const axis: AxisName = event.key === 'ArrowRight' ? 'x' : event.key === 'ArrowLeft' ? 'z' : 'y';
        state.axis = axisOf(state.axis) === axis ? state.home : AXIS_VECTORS[axis];
        state.from = sub(rayPlane({ origin: add(state.pivot, scale(state.axis, 1000)), direction: scale(state.axis, -1) }, state.pivot, state.axis) ?? state.pivot, state.pivot);
        if (length(state.from) < 1e-6) state.from = axis === 'y' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        return;
      }
      const sketch = draw.current;
      if (sketch?.kind === 'polygon' && (event.key === 'Enter' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        if (event.key === 'Enter' && sketch.points.length >= 3) finishPolygon(sketch);
        if (event.key === 'Backspace') { sketch.points.pop(); if (!sketch.points.length) draw.current = undefined; updateDrawOverlay(); }
      }
    }

    function onLeave() { setHover({}); }
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
  });

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
    {marquee && props.overlay.current && createPortal(
      <div className={marquee.crossing ? 'model-marquee crossing' : 'model-marquee'} data-testid="designer-marquee"
        style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />,
      props.overlay.current,
    )}
    <ReferenceGrid />
    {surrounding && <group scale={MM}>
      {surrounding.resolved.solids.filter(solid => !surrounding.hide(solid)).map(solid =>
        <SolidMesh key={`ctx:${solid.id}`} solid={solid} color={colors.get(solid.material) ?? FALLBACK_COLOR} dimmed />)}
    </group>}
    <group scale={MM}>
      <group ref={model} matrixAutoUpdate={false} matrix={frameMatrix}>
        {resolved?.solids.map(solid => <SolidMesh key={solid.id} solid={solid} color={colors.get(solid.material) ?? FALLBACK_COLOR}
          selected={selectedIds.has(solid.id)} hovered={hover.solid === solid.id}
          register={object => { if (object) meshes.current.set(solid.id, object); else meshes.current.delete(solid.id); }} />)}
        {hover.face && <FaceOutline solid={hover.face.solid} side={hover.face.side} edge={hover.face.edge} locked={!!hover.locked} />}
        {overlay.lines?.map((line, index) => <Line key={index} points={line.points.map(point => [point.x, point.y, point.z] as [number, number, number])}
          color={line.color} lineWidth={line.width ?? 1.5} dashed={line.dashed} dashSize={20} gapSize={12} depthTest={false} renderOrder={5} />)}
        {overlay.snap && <Html portal={props.overlay as MutableRefObject<HTMLElement>} position={[overlay.snap.point.x, overlay.snap.point.y, overlay.snap.point.z]} center zIndexRange={[20, 10]}
          style={{ pointerEvents: 'none' }}>
          <span className={`snap-marker snap-${overlay.snap.kind}`} data-testid="designer-snap"
            style={overlay.snap.axis ? { borderColor: AXIS_COLORS[overlay.snap.axis], color: AXIS_COLORS[overlay.snap.axis] } : undefined}>
            <i /> {overlay.snap.label}
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

/** Floor grid with red, green and blue axes through the origin, SketchUp style. */
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

function SolidMesh({ solid, color, selected, hovered, dimmed, register }: {
  solid: ResolvedSolid; color: string; selected?: boolean; hovered?: boolean; dimmed?: boolean; register?: (object: Object3D | null) => void;
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
  return <group>
    <mesh ref={register} geometry={shared.geometry} material={material} userData={{ solidId: solid.id }} castShadow={!dimmed} receiveShadow
      raycast={dimmed ? () => null : undefined} dispose={null} />
    <lineSegments geometry={shared.edges} raycast={() => null} dispose={null}>
      <lineBasicMaterial color={selected ? '#9a5b12' : '#33434e'} transparent opacity={dimmed ? 0.15 : 0.55} />
    </lineSegments>
  </group>;
}

function FaceOutline({ solid, side, edge, locked }: { solid: ResolvedSolid; side: PartFaceSide; edge?: Handle; locked: boolean }) {
  const points = edge?.segment ? [edge.segment[0], edge.segment[1]] : faceLoop(solid, side);
  if (!points) return null;
  return <Line points={points.map(point => [point.x, point.y, point.z] as [number, number, number])} color={locked ? '#963d2b' : HIGHLIGHT}
    lineWidth={edge ? 4 : 3} depthTest={false} renderOrder={4} />;
}
