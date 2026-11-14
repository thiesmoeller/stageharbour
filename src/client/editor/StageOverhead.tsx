import { useEffect, useMemo } from 'react';
import { Shape, ShapeGeometry } from 'three';
import type { BarnDoorFlaps, HangPlan } from '../../shared/hangPlan.js';
import { barnDoorFloorOutline, fixtureFloorPool, resolveFixtureAim } from '../../shared/hangPlan.js';
import { trussHangWorld, type Truss } from '../../shared/truss.js';


/**
 * Scheinwerfer marker in millimetre venue space (inside X-mirror): body, lens and an optional
 * flat floor pool. The light itself comes from FixtureSpotLights.
 */
export function LightingFixtureMesh({ id, x, y, z, aimX, aimY, aimZ, selected = false, intensity = 100, color = '#ffe0b3', beamDeg = 40, barnDoors, showPool = true, onSelect }: {
  id?: string;
  x: number; y: number; z: number;
  aimX?: number; aimY?: number; aimZ?: number;
  selected?: boolean;
  intensity?: number;
  color?: string;
  beamDeg?: number;
  /** Mounted flaps. The floor pool then uses the same crop as the spot cookie. */
  barnDoors?: BarnDoorFlaps;
  showPool?: boolean;
  onSelect?: (id: string, additive: boolean) => void;
}) {
  const hasAim = aimX != null && aimY != null && aimZ != null
    && Number.isFinite(aimX) && Number.isFinite(aimY) && Number.isFinite(aimZ);
  let pitch = 0, yaw = 0;
  if (hasAim) {
    const dx = aimX! - x, dy = aimY! - y, dz = aimZ! - z;
    const dirLen = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dirLen, ny = dy / dirLen, nz = dz / dirLen;
    yaw = Math.atan2(nx, nz);
    pitch = Math.acos(Math.max(-1, Math.min(1, -ny))) - Math.PI / 2;
    if (!Number.isFinite(pitch) || !Number.isFinite(yaw)) { pitch = 0; yaw = 0; }
  }
  const level = Math.max(0, Math.min(1.5, intensity / 100));
  const on = level > 0.02;
  const body = selected ? '#c9a227' : on ? '#3a3a3a' : '#1a1a1a';
  const lens = selected ? '#ffe08a' : on ? color : '#222';
  const pool = showPool && on && hasAim
    ? fixtureFloorPool({ x, y, z }, { x: aimX!, y: aimY!, z: aimZ! }, beamDeg)
    : null;
  return <group position={[x, y, z]} name={id ? `lighting-fixture-${id}` : 'lighting-fixture'}
    userData={id ? { lightingFixtureId: id } : undefined}
    onClick={event => {
      if (!id || !onSelect) return;
      event.stopPropagation();
      onSelect(id, event.shiftKey || event.ctrlKey || event.metaKey);
    }}>
    <group rotation={hasAim ? [pitch, yaw, 0] : [0, 0, 0]}>
      <mesh position={[0, -50, 0]}>
        <boxGeometry args={[120, 100, 120]} />
        <meshBasicMaterial color={body} />
      </mesh>
      <mesh position={[0, -130, 0]}>
        <boxGeometry args={[90, 60, 90]} />
        <meshBasicMaterial color={lens} transparent opacity={on ? 0.55 + level * 0.4 : 0.12} />
      </mesh>
    </group>
    {pool && barnDoors && <BarnDoorFloorPool hang={{ x, y, z }} aim={{ x: aimX!, y: aimY!, z: aimZ! }}
      beamDeg={beamDeg} flaps={barnDoors} color={color} opacity={0.12 + Math.min(1, level) * 0.38} />}
    {pool && !barnDoors && <mesh position={[pool.x - x, 12 - y, pool.z - z]} rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}>
      <circleGeometry args={[pool.radius, 28]} />
      <meshBasicMaterial color={color} transparent opacity={0.12 + Math.min(1, level) * 0.38}
        depthWrite={false} />
    </mesh>}
  </group>;
}

/** Clipped pool on the floor, in the fixture group's millimetre space. */
function BarnDoorFloorPool({ hang, aim, beamDeg, flaps, color, opacity }: {
  hang: { x: number; y: number; z: number };
  aim: { x: number; y: number; z: number };
  beamDeg: number;
  flaps: BarnDoorFlaps;
  color: string;
  opacity: number;
}) {
  const geometry = useMemo(() => {
    const outline = barnDoorFloorOutline(hang, aim, beamDeg, flaps);
    if (!outline) return null;
    const shape = new Shape();
    outline.forEach((point, index) => {
      const localX = point.x - hang.x;
      const localZ = point.z - hang.z;
      if (index === 0) shape.moveTo(localX, localZ);
      else shape.lineTo(localX, localZ);
    });
    shape.closePath();
    const result = new ShapeGeometry(shape);
    result.rotateX(Math.PI / 2);
    return result;
  }, [hang.x, hang.y, hang.z, aim.x, aim.y, aim.z, beamDeg, flaps]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry} position={[0, 12 - hang.y, 0]} raycast={() => null}>
    <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
  </mesh>;
}


/** Hang world position + resolved aim for a fixture (millimetres). */
export function fixtureHangPose(fixture: HangPlan['fixtures'][number], trusses: readonly Truss[], stageWidth: number, stageDepth: number) {
  const truss = trusses.find(item => item.id === fixture.trussId);
  const hang = truss?.hangPoints.find(point => point.id === fixture.hangPointId);
  if (!truss || !hang) return null;
  const world = trussHangWorld(truss, hang);
  const hangPos = { x: world.x, y: truss.bottomHeight, z: world.y };
  const { aim } = resolveFixtureAim(hangPos, fixture.focus, { x: stageWidth / 2, z: stageDepth / 2 }, 50);
  return { hang: hangPos, aim };
}
