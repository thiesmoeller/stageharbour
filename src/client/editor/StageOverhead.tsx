import type { OverheadBox } from '../../shared/overhead.js';
import type { Truss } from '../../shared/truss.js';

export function StageOverhead({ boxes, trusses = [] }: { boxes: OverheadBox[]; trusses?: Truss[] }) {
  return <>
    {boxes.map(box =>
      <mesh key={box.id} position={[box.x, box.bottomHeight + box.thickness / 2, box.y]}
        rotation={[0, -box.rotation * Math.PI / 180, 0]}>
        <boxGeometry args={[box.length, box.thickness, box.width]} />
        <meshBasicMaterial color="#8a6a3a" transparent opacity={0.35} />
      </mesh>)}
    {trusses.map(truss =>
      <group key={truss.id} position={[truss.x, truss.bottomHeight + truss.thickness / 2, truss.y]}
        rotation={[0, -truss.rotation * Math.PI / 180, 0]}>
        <mesh>
          <boxGeometry args={[truss.length, truss.thickness * 0.35, truss.sectionWidth]} />
          <meshBasicMaterial color="#4f86ba" transparent opacity={0.45} />
        </mesh>
      </group>)}
  </>;
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
