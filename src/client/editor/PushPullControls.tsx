import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { DoubleSide, Plane, Quaternion, Vector2, Vector3, type Object3D } from 'three';
import type { VenueGeometry } from '../../shared/layout.js';
import {
  applyPushPull, classifyLocalFace, localNormalFromWorld, planRotationFor, resolvePushPullFace,
  type PushPullHandle,
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
};

function kindFromNode(object: Object3D, scope: 'venue' | 'scene'): { id: string; kind: PushPullKind } | undefined {
  let current: Object3D | null = object;
  while (current) {
    const meta = current.userData?.pushPull as { id?: string; kind?: PushPullKind; scope?: string } | undefined;
    if (meta?.id && meta.kind && meta.scope === scope) return { id: meta.id, kind: meta.kind };
    current = current.parent;
  }
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
  const [hover, setHover] = useState<{ handle: PushPullHandle; point: Vector3; normal: Vector3 }>();
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

  useEffect(() => {
    if (!enabled || !onPushPull) {
      setHover(undefined);
      const active = drag.current; drag.current = undefined;
      if (active) publisher.current?.('cancel', active.start, active.bypass);
      if (controls) controls.enabled = true;
      return;
    }
    const publish = onPushPull;
    function setOrbit(enabledOrbit: boolean) {
      if (controls) controls.enabled = enabledOrbit;
    }
    function pick(clientX: number, clientY: number) {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObjects(scene.children, true).find(hit => {
        if (!hit.object.visible || hit.object.name === 'venue-floor' || hit.object.userData?.pushPullIgnore) return false;
        return !!kindFromNode(hit.object, scope) && !!hit.face;
      });
    }
    function handleFor(hit: { object: Object3D; face: { normal: Vector3 }; point: Vector3 }) {
      const meta = kindFromNode(hit.object, scope);
      if (!meta) return;
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      const rotation = planRotationFor(venue, { ...meta, face: 'py' });
      const local = localNormalFromWorld({ x: worldNormal.x, y: worldNormal.y, z: worldNormal.z }, rotation, true);
      const resolved = resolvePushPullFace({ ...meta, face: classifyLocalFace(local) });
      if (!resolved) return;
      return { handle: resolved, point: hit.point.clone(), normal: worldNormal };
    }
    function onMove(event: PointerEvent) {
      const active = drag.current;
      if (!active) {
        const hit = pick(event.clientX, event.clientY);
        setHover(hit?.face ? handleFor({ object: hit.object, face: hit.face, point: hit.point }) : undefined);
        return;
      }
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(active.plane, hitPoint)) return;
      const deltaM = hitPoint.clone().sub(active.origin).dot(active.normal);
      let deltaMm = deltaM * 1000;
      active.bypass = event.altKey || !snapEnabled;
      if (!active.bypass) deltaMm = Math.round(deltaMm / 5) * 5;
      const next = applyPushPull(active.start, active.handle, deltaMm);
      active.latest = next;
      publish('preview', next, active.bypass);
    }
    function onDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const hit = pick(event.clientX, event.clientY);
      if (!hit?.face) return;
      const picked = handleFor({ object: hit.object, face: hit.face, point: hit.point });
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
      gl.domElement.setPointerCapture(event.pointerId);
    }
    function endDrag(event: PointerEvent, cancel: boolean) {
      const active = drag.current;
      if (!active) return;
      const bypass = active.bypass || event.altKey || !snapEnabled;
      const latest = active.latest;
      drag.current = undefined;
      setOrbit(true);
      publish(cancel ? 'cancel' : 'commit', latest, bypass);
      if (gl.domElement.hasPointerCapture(event.pointerId)) gl.domElement.releasePointerCapture(event.pointerId);
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
    gl.domElement.addEventListener('pointermove', onMove);
    gl.domElement.addEventListener('pointerdown', onDown);
    gl.domElement.addEventListener('pointerup', onUp);
    gl.domElement.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      if (!drag.current) setOrbit(true);
      gl.domElement.removeEventListener('pointermove', onMove);
      gl.domElement.removeEventListener('pointerdown', onDown);
      gl.domElement.removeEventListener('pointerup', onUp);
      gl.domElement.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [axis, camera, camDir, controls, enabled, gl, hitPoint, ndc, onPushPull, planeNormal, raycaster, scene, side, snapEnabled, venue, scope]);

  if (!enabled || !hover) return null;
  return <FaceHighlight point={hover.point} normal={hover.normal} />;
}

function FaceHighlight({ point, normal }: { point: Vector3; normal: Vector3 }) {
  const quaternion = useMemo(
    () => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal.clone().normalize()),
    [normal],
  );
  return <mesh position={point} quaternion={quaternion} userData={{ pushPullIgnore: true }} raycast={() => {}}>
    <planeGeometry args={[1.2, 1.2]} />
    <meshBasicMaterial color="#e9a83b" transparent opacity={0.45} depthTest={false} side={DoubleSide} />
  </mesh>;
}

export default PushPullControls;
