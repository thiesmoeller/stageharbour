import type { PlaceholderSolid } from '../../shared/placeholders.js';

const color: Record<PlaceholderSolid['kind'], string> = {
  table: '#7d8f6c', chair: '#8fa07a', person: '#c4a574', speaker: '#6a7d92', box: '#a09070',
};

export function StagePlaceholders({ placeholders, lit = false }: { placeholders: PlaceholderSolid[]; lit?: boolean }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  return placeholders.map(item => <mesh castShadow={lit} receiveShadow={lit} key={item.id} position={[item.center.x, item.center.y, item.center.z]} rotation={[0, item.rotationY, 0]}>
    <boxGeometry args={[item.size.x, item.size.y, item.size.z]} />
    <Surface color={color[item.kind]} />
  </mesh>);
}

export function StagePlaceholderList({ placeholders }: { placeholders: PlaceholderSolid[] }) {
  if (!placeholders.length) return null;
  return <ul aria-label="Platzhalter in der Raumsicht">{placeholders.map(item => <li key={item.id} data-testid={`stage-placeholder-${item.id}`}
    data-x={item.center.x} data-y={item.center.y} data-z={item.center.z}
    data-height={item.size.y} data-width={item.size.x} data-depth={item.size.z} data-kind={item.kind}>
    {item.label}: {item.size.x} × {item.size.z} mm, {item.size.y} mm hoch</li>)}</ul>;
}
