import { useLayoutEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import { curtainLeafFoldSamples, curtainLeafSpans, type Curtain } from '../../shared/curtains.js';

/** Matte black theatre molton — high roughness, no specular shine. */
const MOLTON = { color: '#0c0c0c', roughness: 0.94, metalness: 0 } as const;

function moltonLeafGeometry(leafLength: number, height: number, openPercent: number): BufferGeometry {
  const folds = curtainLeafFoldSamples(leafLength, openPercent, 56);
  const rows = 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row < rows; row++) {
    const y = row === 0 ? 0 : height;
    for (const fold of folds) {
      positions.push(fold.x, y, fold.z);
      normals.push(0, 0, 1);
    }
  }
  const cols = folds.length;
  for (let i = 0; i < cols - 1; i++) {
    const a = i, b = i + 1, c = i + cols, d = i + 1 + cols;
    indices.push(a, b, d, a, d, c);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function CurtainLeaf({ length, height, openPercent, alongCentre }: {
  length: number; height: number; openPercent: number; alongCentre: number;
}) {
  const geometry = useMemo(
    () => moltonLeafGeometry(length, height, openPercent),
    [length, height, openPercent],
  );
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh position={[alongCentre, 0, 0]} geometry={geometry} castShadow receiveShadow>
    <meshStandardMaterial color={MOLTON.color} roughness={MOLTON.roughness} metalness={MOLTON.metalness}
      side={DoubleSide} shadowSide={DoubleSide} />
  </mesh>;
}

export function StageCurtains({ curtains }: { curtains: Curtain[] }) {
  return <>
    {curtains.map(curtain => {
      const spans = curtainLeafSpans(curtain);
      return <group key={curtain.id} position={[curtain.x, curtain.bottomClearance, curtain.y]}
        rotation={[0, -curtain.rotation * Math.PI / 180, 0]}>
        {/* Thin track rail */}
        <mesh position={[0, curtain.height + 20, 0]} castShadow receiveShadow>
          <boxGeometry args={[curtain.length, 30, 40]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.7} metalness={0.15} />
        </mesh>
        {spans.map((span, index) => {
          const length = span.end - span.start;
          const centre = (span.start + span.end) / 2;
          return <CurtainLeaf key={index} length={length} height={curtain.height}
            openPercent={curtain.openPercent} alongCentre={centre} />;
        })}
      </group>;
    })}
  </>;
}
