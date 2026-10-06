import type { OverheadBox } from '../../shared/overhead.js';
import type { HangPlan } from '../../shared/hangPlan.js';
import { fixtureFloorPool, resolveFixtureAim } from '../../shared/hangPlan.js';
import { trussHangWorld, type Truss } from '../../shared/truss.js';

export function StageOverhead({ boxes, trusses = [], hangPlan, showTrusses = true, showLightingFixtures = true }: {
  boxes: OverheadBox[];
  trusses?: Truss[];
  hangPlan?: HangPlan;
  showTrusses?: boolean;
  showLightingFixtures?: boolean;
}) {
  const fixtures = hangPlan?.fixtures ?? [];
  return <>
    {boxes.map(box =>
      <mesh key={box.id} position={[box.x, box.bottomHeight + box.thickness / 2, box.y]}
        rotation={[0, -box.rotation * Math.PI / 180, 0]}>
        <boxGeometry args={[box.length, box.thickness, box.width]} />
        <meshBasicMaterial color="#8a6a3a" transparent opacity={0.35} />
      </mesh>)}
    {showTrusses && trusses.map(truss =>
      <group key={truss.id} position={[truss.x, truss.bottomHeight + truss.thickness / 2, truss.y]}
        rotation={[0, -truss.rotation * Math.PI / 180, 0]}>
        <mesh>
          <boxGeometry args={[truss.length, truss.thickness * 0.35, truss.sectionWidth]} />
          <meshBasicMaterial color="#4f86ba" transparent opacity={0.45} />
        </mesh>
      </group>)}
    {showLightingFixtures && fixtures.map(fixture => {
      const truss = trusses.find(item => item.id === fixture.trussId);
      const hang = truss?.hangPoints.find(point => point.id === fixture.hangPointId);
      if (!truss || !hang) return null;
      const world = trussHangWorld(truss, hang);
      return <LightingFixtureMesh key={fixture.id} id={fixture.id} x={world.x} y={truss.bottomHeight} z={world.y} showPool={false} />;
    })}
  </>;
}

/**
 * Scheinwerfer marker in millimetre venue space (inside X-mirror).
 * Box + flat floor pool only — no SpotLights/cones (Pascal WebGPU forceWebGL).
 */
export function LightingFixtureMesh({ id, x, y, z, aimX, aimY, aimZ, selected = false, intensity = 100, color = '#ffe0b3', beamDeg = 40, showPool = true, onSelect }: {
  id?: string;
  x: number; y: number; z: number;
  aimX?: number; aimY?: number; aimZ?: number;
  selected?: boolean;
  intensity?: number;
  color?: string;
  beamDeg?: number;
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
    {pool && <mesh position={[pool.x - x, 12 - y, pool.z - z]} rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}>
      <circleGeometry args={[pool.radius, 28]} />
      <meshBasicMaterial color={color} transparent opacity={0.12 + Math.min(1, level) * 0.38}
        depthWrite={false} />
    </mesh>}
  </group>;
}

export function StageOverheadList({ boxes, trusses = [] }: { boxes: OverheadBox[]; trusses?: Truss[] }) {
  if (!boxes.length && !trusses.length) return null;
  return <ul aria-label="Überbauungen in der Raumsicht">
    {boxes.map(box => <li key={box.id} data-testid={`stage-overhead-${box.id}`}
      data-x={box.x} data-z={box.y} data-bottom={box.bottomHeight} data-thickness={box.thickness}
      data-length={box.length} data-width={box.width} data-rotation={box.rotation}>
      {box.label}: Unterkante {box.bottomHeight} mm, {box.length} × {box.width} × {box.thickness} mm</li>)}
    {trusses.map(truss => <li key={truss.id} data-testid={`stage-truss-${truss.id}`}
      data-x={truss.x} data-z={truss.y} data-bottom={truss.bottomHeight} data-thickness={truss.thickness}
      data-length={truss.length} data-width={truss.sectionWidth} data-rotation={truss.rotation}>
      {truss.label}: Unterkante {truss.bottomHeight} mm, {truss.length} × {truss.sectionWidth} × {truss.thickness} mm</li>)}
  </ul>;
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
