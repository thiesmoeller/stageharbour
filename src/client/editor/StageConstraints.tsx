import { useEffect, useMemo } from 'react';
import { Line } from '@react-three/drei';
import { Shape, ShapeGeometry, DoubleSide } from 'three';
import type { StageNode } from './pascalScene.js';
import { StageCurtains } from './StageCurtains.js';
import { LightingFixtureMesh, fixtureHangPose } from './StageOverhead.js';
import type { HangPlan } from '../../shared/hangPlan.js';
import type { FixtureBoardOutput } from '../../shared/lightBoard.js';

export function StageConstraint({ element, elevation = 0, hangPlan, fixtureLevel, showTrusses = true, showLightingFixtures = true, stageWidth = 0, stageDepth = 0, selectedFixtureId, onFixtureSelect }: {
  element: StageNode['element'];
  elevation?: number;
  hangPlan?: HangPlan;
  fixtureLevel?: (fixtureId: string) => FixtureBoardOutput;
  showTrusses?: boolean;
  showLightingFixtures?: boolean;
  stageWidth?: number;
  stageDepth?: number;
  selectedFixtureId?: string | null;
  onFixtureSelect?: (id: string, additive: boolean) => void;
}) {
  const geometry = useMemo(() => {
    if (element.kind !== 'zone') return undefined;
    const shape = new Shape();
    element.value.polygon.forEach((p, i) => i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y));
    shape.closePath(); const result = new ShapeGeometry(shape); result.rotateX(Math.PI / 2); return result;
  }, [element]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (element.kind === 'zone') return <mesh geometry={geometry} position={[0, elevation + 5, 0]}><meshBasicMaterial color="#db7654" side={DoubleSide} transparent opacity={.22} depthWrite={false} /></mesh>;
  if (element.kind === 'overhead') {
    const box = element.value;
    return <mesh position={[box.x, box.bottomHeight + box.thickness / 2, box.y]} rotation={[0, -box.rotation * Math.PI / 180, 0]}>
      <boxGeometry args={[box.length, box.thickness, box.width]} />
      <meshStandardMaterial color="#8a6a3a" transparent opacity={.4} />
    </mesh>;
  }
  if (element.kind === 'truss') {
    const truss = element.value;
    const fixtures = (hangPlan?.fixtures ?? []).filter(fixture => fixture.trussId === truss.id);
    return <>
      {showTrusses && <group position={[truss.x, truss.bottomHeight + truss.thickness / 2, truss.y]} rotation={[0, -truss.rotation * Math.PI / 180, 0]}>
        <mesh>
          <boxGeometry args={[truss.length, truss.thickness * 0.35, truss.sectionWidth]} />
          <meshStandardMaterial color="#4f86ba" transparent opacity={.55} />
        </mesh>
        <mesh position={[0, truss.thickness * 0.25, 0]}>
          <boxGeometry args={[truss.length * 0.98, truss.thickness * 0.2, truss.sectionWidth * 0.35]} />
          <meshStandardMaterial color="#2f5f8a" transparent opacity={.7} />
        </mesh>
        {truss.hangPoints.map(hang => <mesh key={hang.id} position={[hang.offsetMm, -truss.thickness * 0.4, 0]}>
          <boxGeometry args={[80, 80, 80]} />
          <meshBasicMaterial color="#1e3f5c" />
        </mesh>)}
      </group>}
      {showLightingFixtures && fixtures.map(fixture => {
        const pose = fixtureHangPose(fixture, [truss], stageWidth, stageDepth);
        if (!pose) return null;
        const level = fixtureLevel?.(fixture.id) ?? { intensity: 0, color: '#ffe0b3' };
        const beamDeg = fixture.focus?.beam ?? 40;
        return <LightingFixtureMesh key={fixture.id} id={fixture.id}
          x={pose.hang.x} y={pose.hang.y} z={pose.hang.z}
          aimX={pose.aim.x} aimY={pose.aim.y} aimZ={pose.aim.z}
          selected={fixture.id === selectedFixtureId}
          intensity={level.intensity} color={level.color} beamDeg={beamDeg}
          showPool={false}
          onSelect={onFixtureSelect} />;
      })}
    </>;
  }
  if (element.kind === 'curtain') return <StageCurtains curtains={[element.value]} />;
  if (element.kind === 'pin') return <mesh position={[element.value.x, 100, element.value.y]}><sphereGeometry args={[80, 12, 8]} /><meshStandardMaterial color={element.value.kind === 'power' ? '#d69d34' : '#4f86ba'} /></mesh>;
  if (element.kind === 'corridor') return <Line points={element.value.path.map(p => [p.x, 15, p.y])} color="#5a6e8a" lineWidth={3} />;
  return null;
}
