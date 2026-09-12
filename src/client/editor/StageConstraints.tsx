import { useEffect, useMemo } from 'react';
import { Line } from '@react-three/drei';
import { Shape, ShapeGeometry, DoubleSide } from 'three';
import type { StageNode } from './pascalScene.js';

export function StageConstraint({ element, elevation = 0 }: { element: StageNode['element']; elevation?: number }) {
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
    return <mesh position={[box.x, box.bottomHeight + box.thickness / 2, box.y]}><boxGeometry args={[box.length, box.thickness, box.width]} /><meshStandardMaterial color="#8a6a3a" transparent opacity={.4} /></mesh>;
  }
  if (element.kind === 'pin') return <mesh position={[element.value.x, 100, element.value.y]}><sphereGeometry args={[80, 12, 8]} /><meshStandardMaterial color={element.value.kind === 'power' ? '#d69d34' : '#4f86ba'} /></mesh>;
  if (element.kind === 'corridor') return <Line points={element.value.path.map(p => [p.x, 15, p.y])} color="#5a6e8a" lineWidth={3} />;
  return null;
}
