import type { BraceSolid } from '../../shared/braceTransforms.js';

function BraceMesh({ brace, lit }: { brace: BraceSolid; lit?: boolean }) {
  const elevation = brace.footprint[0]?.y ?? 0;
  return <group position={[brace.center.x, elevation, brace.center.z]} rotation={[0, brace.rotationY, 0]}>
    {brace.ballast.map((part, index) => <mesh key={`ballast-${index}`} castShadow={lit} receiveShadow={lit}
      position={[part.center.x, part.center.y, part.center.z]} rotation={[part.rotation.x, part.rotation.y, part.rotation.z]}>
      <boxGeometry args={[part.size.x, part.size.y, part.size.z]} />
      {lit ? <meshStandardMaterial color={part.kind === 'slab' ? '#999b96' : part.kind === 'strap' ? '#de862a' : '#666666'} roughness={0.95} />
        : <meshBasicMaterial color={part.kind === 'slab' ? '#999b96' : part.kind === 'strap' ? '#de862a' : '#666666'} />}
    </mesh>)}
    {brace.members.map(member => <mesh key={member.kind} castShadow={lit} receiveShadow={lit}
      position={[member.center.x, member.center.y, member.center.z]}
      rotation={[member.rotation.x, member.rotation.y, member.rotation.z]}>
      <boxGeometry args={[member.size.x, member.size.y, member.size.z]} />
      {lit
        ? <meshStandardMaterial color="#c4a574" roughness={0.85} />
        : <meshBasicMaterial color="#c4a574" />}
    </mesh>)}
  </group>;
}

export function StageBraces({ braces, lit }: { braces: BraceSolid[]; lit?: boolean }) {
  return braces.map(brace => <BraceMesh key={brace.id} brace={brace} lit={lit} />);
}

export function StageBraceList({ braces }: { braces: BraceSolid[] }) {
  if (!braces.length) return null;
  return <ul aria-label="Stützen in der Raumsicht">{braces.map(brace => <li key={brace.id} data-testid={`stage-brace-${brace.id}`}
    data-x={brace.center.x} data-y={brace.center.y} data-z={brace.center.z}
    data-slabs={brace.ballast.filter(part => part.kind === 'slab').length} data-straps={brace.ballast.some(part => part.kind === 'buckle') ? 1 : 0}
    data-height={brace.size.y} data-footprint-width={brace.size.x} data-footprint-depth={brace.size.z}>
    {brace.label}: Stützdreieck {brace.size.x} × {brace.size.z} mm, {brace.size.y} mm hoch</li>)}</ul>;
}
