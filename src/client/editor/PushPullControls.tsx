import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { DoubleSide, Mesh, Plane, Quaternion, Vector2, Vector3, type Material, type Object3D } from 'three';
import type { VenueGeometry } from '../../shared/layout.js';
import { hitWorldNormal, instanceOwner } from '../stage/instancing.js';
import {
  applyPushPull, classifyLocalFace, inferenceDeltaMm, inferenceFaceAligned, localNormalFromWorld, planRotationFor,
  resolveDragDeltaMm, resolvePushPullFace, stageDeckDragAxisMm,
  type OpeningEdge, type PushPullHandle,
} from '../../shared/pushPull.js';

type PushPullKind = PushPullHandle['kind'];
type DragState = {
  handle: PushPullHandle;
  start: VenueGeometry;
  origin: Vector3;
  normal: Vector3;
  plane: Plane;
  bypass: boolean;
  latest: VenueGeometry;
  lastDeltaMm?: number;
};

type NodeHit = { id: string; kind: PushPullKind; openingId?: string; edge?: OpeningEdge };

type PushPullMeta = { id?: string; kind?: PushPullKind; scope?: string; openingId?: string; edge?: OpeningEdge };
type Hit = { object: Object3D; instanceId?: number };

/** What a hit belongs to: asked of the instance's owner first, then up the parent chain. */
function kindFromHit(hit: Hit, scope: 'venue' | 'scene'): NodeHit | undefined {
  const usable = (meta: PushPullMeta | undefined): NodeHit | undefined => {
    if (meta?.kind === 'wallOpening' && meta.id && meta.openingId && meta.edge && meta.scope === scope) {
      return { id: meta.id, kind: 'wallOpening', openingId: meta.openingId, edge: meta.edge };
    }
    if (meta?.id && meta.kind && meta.kind !== 'wallOpening' && meta.scope === scope) {
      return { id: meta.id, kind: meta.kind };
    }
  };
  const owned = usable(instanceOwner(hit.object, hit.instanceId)?.userData?.pushPull as PushPullMeta | undefined);
  if (owned) return owned;
  for (let current: Object3D | null = hit.object; current; current = current.parent) {
    const found = usable(current.userData?.pushPull as PushPullMeta | undefined);
    if (found) return found;
  }
}

function isSameHandle(meta: NodeHit | undefined, handle: PushPullHandle) {
  if (!meta) return false;
  if (handle.kind === 'wallOpening') {
    return meta.kind === 'wallOpening' && meta.id === handle.id
      && meta.openingId === handle.openingId && meta.edge === handle.edge;
  }
  return meta.kind === handle.kind && meta.id === handle.id;
}

function isInvisiblePickProxy(object: Object3D) {
  if (!(object instanceof Mesh)) return false;
  const mats: Material[] = Array.isArray(object.material) ? object.material : [object.material];
  return mats.length > 0 && mats.every(mat => !!(mat as Material & { transparent?: boolean; opacity?: number }).transparent
    && ((mat as Material & { opacity?: number }).opacity ?? 1) < 0.05);
}

/** World-space direction that grows the cutout when dragging an opening edge. */
function openingGrowNormal(edge: OpeningEdge, planRotationDeg: number, mirroredX: boolean, target: Vector3) {
  const local = edge === 'left' ? { x: -1, y: 0, z: 0 }
    : edge === 'right' ? { x: 1, y: 0, z: 0 }
      : edge === 'bottom' ? { x: 0, y: -1, z: 0 }
        : { x: 0, y: 1, z: 0 };
  const angle = planRotationDeg * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let wx = local.x * cos - local.z * sin;
  const wz = local.x * sin + local.z * cos;
  if (mirroredX) wx = -wx;
  return target.set(wx, local.y, wz).normalize();
}

export function PushPullControls({
  venue, enabled, scope = 'venue', snapEnabled = true, onPushPull,
}: {
  venue: VenueGeometry;
  enabled: boolean;
  scope?: 'venue' | 'scene';
  snapEnabled?: boolean;
  onPushPull?: (phase: 'begin' | 'preview' | 'commit' | 'cancel', next: VenueGeometry, bypass: boolean) => void;
}) {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scene = useThree(state => state.scene);
  const raycaster = useThree(state => state.raycaster);
  const controls = useThree(state => state.controls) as { enabled?: boolean } | null;
  const [hover, setHover] = useState<{ handle: PushPullHandle; point: Vector3; normal: Vector3; inferred?: boolean }>();
  const drag = useRef<DragState | undefined>(undefined);
  const publisher = useRef(onPushPull); publisher.current = onPushPull;
  const currentControls = useRef(controls); currentControls.current = controls;
  useEffect(() => () => {
    const active = drag.current;
    drag.current = undefined;
    if (currentControls.current) currentControls.current.enabled = true;
    if (active) publisher.current?.('cancel', active.start, active.bypass);
  }, []);
  const ndc = useMemo(() => new Vector2(), []);
  const hitPoint = useMemo(() => new Vector3(), []);
  const axis = useMemo(() => new Vector3(), []);
  const side = useMemo(() => new Vector3(), []);
  const planeNormal = useMemo(() => new Vector3(), []);
  const camDir = useMemo(() => new Vector3(), []);
  const snapPoint = useMemo(() => new Vector3(), []);

  useEffect(() => {
    if (!enabled || !onPushPull) {
      setHover(undefined);
      const active = drag.current; drag.current = undefined;
      if (active) publisher.current?.('cancel', active.start, active.bypass);
      if (controls) controls.enabled = true;
      return;
    }
    const target = gl.domElement;
    if (!target) return;
    const publish = onPushPull;
    function setOrbit(enabledOrbit: boolean) {
      if (controls) controls.enabled = enabledOrbit;
    }
    function pick(clientX: number, clientY: number) {
      const rect = target.getBoundingClientRect();
      ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObjects(scene.children, true).find(hit => {
        if (!hit.object.visible || hit.object.name === 'venue-floor' || hit.object.userData?.pushPullIgnore) return false;
        return !!kindFromHit(hit, scope) && !!hit.face;
      });
    }
    /**
     * First solid under the cursor whose face is parallel to the drag axis.
     * Tops / floors / angled hits are ignored so side-face pulls do not collapse.
     */
    function inferencePoint(clientX: number, clientY: number, handle: PushPullHandle, axisNormal: Vector3) {
      const rect = target.getBoundingClientRect();
      ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        if (!hit.object.visible || hit.object.name === 'venue-floor' || hit.object.userData?.pushPullIgnore) continue;
        if (isInvisiblePickProxy(hit.object)) continue;
        if (isSameHandle(kindFromHit(hit, scope), handle)) continue;
        if (!hit.face) continue;
        const faceNormal = hitWorldNormal(hit, new Vector3())!;
        if (!inferenceFaceAligned(
          { x: axisNormal.x, y: axisNormal.y, z: axisNormal.z },
          { x: faceNormal.x, y: faceNormal.y, z: faceNormal.z },
        )) continue;
        return hit.point;
      }
    }
    function handleFor(hit: Hit & { face: { normal: Vector3 }; point: Vector3 }) {
      const meta = kindFromHit(hit, scope);
      if (!meta) return;
      if (meta.kind === 'wallOpening' && meta.openingId && meta.edge) {
        const handle: PushPullHandle = {
          kind: 'wallOpening', id: meta.id, openingId: meta.openingId, edge: meta.edge,
        };
        const rotation = planRotationFor(venue, handle);
        const normal = openingGrowNormal(meta.edge, rotation, true, new Vector3());
        return { handle, point: hit.point.clone(), normal };
      }
      const worldNormal = hitWorldNormal(hit, new Vector3())!;
      const rotation = planRotationFor(venue, { kind: meta.kind as Exclude<PushPullKind, 'wallOpening'>, id: meta.id, face: 'py' });
      const local = localNormalFromWorld({ x: worldNormal.x, y: worldNormal.y, z: worldNormal.z }, rotation, true);
      const resolved = resolvePushPullFace({ kind: meta.kind as Exclude<PushPullKind, 'wallOpening'>, id: meta.id, face: classifyLocalFace(local) });
      if (!resolved) return;
      return { handle: resolved, point: hit.point.clone(), normal: worldNormal };
    }
    function onMove(event: PointerEvent) {
      const active = drag.current;
      if (!active) {
        const hit = pick(event.clientX, event.clientY);
        setHover(hit?.face ? handleFor({ object: hit.object, instanceId: hit.instanceId, face: hit.face, point: hit.point }) : undefined);
        return;
      }
      const rect = target.getBoundingClientRect();
      ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(active.plane, hitPoint)) return;
      const freeDeltaMm = hitPoint.clone().sub(active.origin).dot(active.normal) * 1000;
      active.bypass = event.altKey || !snapEnabled;
      const pointed = !active.bypass
        ? inferencePoint(event.clientX, event.clientY, active.handle, active.normal)
        : undefined;
      const inferenceMm = pointed
        ? inferenceDeltaMm(
          { x: active.origin.x, y: active.origin.y, z: active.origin.z },
          { x: active.normal.x, y: active.normal.y, z: active.normal.z },
          { x: pointed.x, y: pointed.y, z: pointed.z },
        )
        : undefined;
      const { deltaMm, inferred } = resolveDragDeltaMm(freeDeltaMm, inferenceMm, {
        snapEnabled, bypass: active.bypass,
        stageDeckCurrentMm: stageDeckDragAxisMm(active.start, active.handle),
      });
      snapPoint.copy(active.origin).addScaledVector(active.normal, deltaMm / 1000);
      setHover({ handle: active.handle, point: snapPoint.clone(), normal: active.normal, inferred });
      // Skip redundant previews: every preview rebuilds the stage model.
      if (active.lastDeltaMm === deltaMm) return;
      const next = applyPushPull(active.start, active.handle, deltaMm);
      active.lastDeltaMm = deltaMm;
      active.latest = next;
      publish('preview', next, active.bypass);
    }
    function onDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const hit = pick(event.clientX, event.clientY);
      if (!hit?.face) return;
      const picked = handleFor({ object: hit.object, instanceId: hit.instanceId, face: hit.face, point: hit.point });
      if (!picked) return;
      event.preventDefault();
      event.stopPropagation();
      setOrbit(false);
      camera.getWorldDirection(camDir);
      axis.copy(picked.normal);
      side.crossVectors(camDir, axis);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      side.normalize();
      planeNormal.crossVectors(axis, side).normalize();
      const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, picked.point);
      drag.current = {
        handle: picked.handle, start: structuredClone(venue), origin: picked.point.clone(),
        normal: picked.normal.clone(), plane, bypass: event.altKey || !snapEnabled, latest: venue,
      };
      setHover(picked);
      publish('begin', venue, drag.current.bypass);
      target.setPointerCapture(event.pointerId);
    }
    function endDrag(event: PointerEvent, cancel: boolean) {
      const active = drag.current;
      if (!active) return;
      const bypass = active.bypass || event.altKey || !snapEnabled;
      const latest = active.latest;
      drag.current = undefined;
      setOrbit(true);
      publish(cancel ? 'cancel' : 'commit', latest, bypass);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    }
    function onUp(event: PointerEvent) { endDrag(event, false); }
    function onCancel(event: PointerEvent) { endDrag(event, true); }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !drag.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
      drag.current = undefined;
      setOrbit(true);
      publish('cancel', venue, false);
    }
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      if (!drag.current) setOrbit(true);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [axis, camera, camDir, controls, enabled, gl, hitPoint, ndc, onPushPull, planeNormal, raycaster, scene, side, snapEnabled, snapPoint, venue, scope]);

  if (!enabled || !hover) return null;
  return <FaceHighlight point={hover.point} normal={hover.normal} inferred={!!hover.inferred} />;
}

function FaceHighlight({ point, normal, inferred }: { point: Vector3; normal: Vector3; inferred?: boolean }) {
  const quaternion = useMemo(
    () => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal.clone().normalize()),
    [normal],
  );
  return <mesh position={point} quaternion={quaternion} userData={{ pushPullIgnore: true }} raycast={() => {}}>
    <planeGeometry args={[inferred ? 1.6 : 1.2, inferred ? 1.6 : 1.2]} />
    <meshBasicMaterial color={inferred ? '#f0b429' : '#e9a83b'} transparent opacity={inferred ? 0.65 : 0.45} depthTest={false} side={DoubleSide} />
  </mesh>;
}

export default PushPullControls;
