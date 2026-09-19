import type { PlaceholderSolid } from '../../shared/placeholders.js';

const color: Record<PlaceholderSolid['kind'], string> = {
  table: '#7d8f6c', chair: '#8fa07a', person: '#c4a574', speaker: '#6a7d92', box: '#a09070',
};

function ChairMesh({ item, lit }: { item: PlaceholderSolid; lit: boolean }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  const w = item.size.x, h = item.size.y, d = item.size.z;
  const seatH = h * 0.48, seatT = Math.max(20, h * 0.06), backT = Math.max(20, d * 0.08), leg = Math.max(18, Math.min(w, d) * 0.08);
  return <group position={[item.center.x, item.center.y - h / 2, item.center.z]} rotation={[0, item.rotationY, 0]}>
    <mesh castShadow={lit} receiveShadow={lit} position={[0, seatH, 0]}>
      <boxGeometry args={[w * 0.92, seatT, d * 0.75]} />
      <Surface color={color.chair} />
    </mesh>
    <mesh castShadow={lit} receiveShadow={lit} position={[0, seatH + (h - seatH) / 2, -d * 0.32]}>
      <boxGeometry args={[w * 0.92, h - seatH, backT]} />
      <Surface color="#6f805f" />
    </mesh>
    {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz]) =>
      <mesh key={`${sx}${sz}`} castShadow={lit} position={[sx * (w * 0.38), seatH / 2, sz * (d * 0.28)]}>
        <boxGeometry args={[leg, seatH, leg]} />
        <Surface color="#5a6e52" />
      </mesh>)}
    {item.seatedFigure && <group position={[0, seatH + seatT / 2, d * 0.02]}>
      <mesh castShadow={lit} position={[0, h * 0.18, 0]}>
        <boxGeometry args={[w * 0.35, h * 0.28, d * 0.28]} />
        <Surface color="#d9c6a1" />
      </mesh>
      <mesh castShadow={lit} position={[0, h * 0.38, 0]}>
        <sphereGeometry args={[Math.min(w, d) * 0.12, 12, 8]} />
        <Surface color="#d9c6a1" />
      </mesh>
      <mesh castShadow={lit} position={[0, h * 0.06, d * 0.12]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[w * 0.32, h * 0.12, d * 0.35]} />
        <Surface color="#c4a574" />
      </mesh>
    </group>}
  </group>;
}

export function StagePlaceholders({ placeholders, lit = false }: { placeholders: PlaceholderSolid[]; lit?: boolean }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  return placeholders.map(item => item.kind === 'chair'
    ? <ChairMesh key={item.id} item={item} lit={lit} />
    : <mesh castShadow={lit} receiveShadow={lit} key={item.id} position={[item.center.x, item.center.y, item.center.z]} rotation={[0, item.rotationY, 0]}>
      <boxGeometry args={[item.size.x, item.size.y, item.size.z]} />
      <Surface color={color[item.kind]} />
    </mesh>);
}

export function StagePlaceholderList({ placeholders }: { placeholders: PlaceholderSolid[] }) {
  if (!placeholders.length) return null;
  return <ul aria-label="Platzhalter in der Raumsicht">{placeholders.map(item => <li key={item.id} data-testid={`stage-placeholder-${item.id}`}
    data-x={item.center.x} data-y={item.center.y} data-z={item.center.z}
    data-height={item.size.y} data-width={item.size.x} data-depth={item.size.z} data-kind={item.kind}
    data-seated={item.seatedFigure ? 'true' : undefined}>
    {item.label}: {item.size.x} × {item.size.z} mm, {item.size.y} mm hoch{item.seatedFigure ? ', Sitzfigur' : ''}</li>)}</ul>;
}
