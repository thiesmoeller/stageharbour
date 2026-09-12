import { useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import type { BraceSolid } from '../../shared/braceTransforms.js';

function BraceMesh({ brace, lit }: { brace: BraceSolid; lit?: boolean }) {
  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    const [p0, p1, p2, p3] = brace.footprint;
    const [r0, r1] = brace.ridge;
    if (!p0 || !p1 || !p2 || !p3 || !r0 || !r1) return geo;
    geo.setAttribute('position', new Float32BufferAttribute([
      p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z,
      r0.x, r0.y, r0.z, r1.x, r1.y, r1.z,
    ], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3, 0, 1, 5, 0, 5, 4, 0, 4, 3, 1, 2, 5, 3, 4, 5, 3, 5, 2]);
    geo.computeVertexNormals();
    return geo;
  }, [brace]);
  return <mesh geometry={geometry} castShadow={lit} receiveShadow={lit}>{lit
    ? <meshStandardMaterial color="#c4a574" roughness={0.9} side={DoubleSide} />
    : <meshBasicMaterial color="#c4a574" side={DoubleSide} />}</mesh>;
}

export function StageBraces({ braces, lit }: { braces: BraceSolid[]; lit?: boolean }) {
  return braces.map(brace => <BraceMesh key={brace.id} brace={brace} lit={lit} />);
}

export function StageBraceList({ braces }: { braces: BraceSolid[] }) {
  if (!braces.length) return null;
  return <ul aria-label="Stützen in der Raumsicht">{braces.map(brace => <li key={brace.id} data-testid={`stage-brace-${brace.id}`}
    data-x={brace.center.x} data-y={brace.center.y} data-z={brace.center.z}
    data-height={brace.size.y} data-footprint-width={brace.size.x} data-footprint-depth={brace.size.z}>
    {brace.label}: {brace.size.x} × {brace.size.z} mm, {brace.size.y} mm hoch</li>)}</ul>;
}
