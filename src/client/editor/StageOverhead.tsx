import type { OverheadBox } from '../../shared/overhead.js';

export function StageOverhead({ boxes }: { boxes: OverheadBox[] }) {
  return <>
    {boxes.map(box =>
      <mesh key={box.id} position={[box.x, box.bottomHeight + box.thickness / 2, box.y]}>
        <boxGeometry args={[box.length, box.thickness, box.width]} />
        <meshBasicMaterial color="#8a6a3a" transparent opacity={0.35} />
      </mesh>)}
  </>;
}

export function StageOverheadList({ boxes }: { boxes: OverheadBox[] }) {
  if (!boxes.length) return null;
  return <ul aria-label="Überbauungen in der Raumsicht">
    {boxes.map(box => <li key={box.id} data-testid={`stage-overhead-${box.id}`}
      data-x={box.x} data-z={box.y} data-bottom={box.bottomHeight} data-thickness={box.thickness}
      data-length={box.length} data-width={box.width}>
      {box.label}: Unterkante {box.bottomHeight} mm, {box.length} × {box.width} × {box.thickness} mm</li>)}
  </ul>;
}
