import type { PointerEvent } from 'react';
import { rotationHandlePoint } from '../../shared/snapping.js';

/** Shared orange ↻ handle used by every placeable plan object. */
export function RotationHandle({
  centre, rotation, width, testId, label, onPointerDown,
}: {
  centre: { x: number; y: number }; rotation: number; width: number;
  testId: string; label: string;
  onPointerDown: (event: PointerEvent<SVGGElement>) => void;
}) {
  const handle = rotationHandlePoint({ x: centre.x, y: centre.y, rotation, width });
  return <g className="rotation-handle" data-testid={testId} aria-label={label} onPointerDown={onPointerDown}>
    <line x1={centre.x} y1={-centre.y} x2={handle.x} y2={-handle.y}
      stroke="#b67c35" strokeWidth="2" strokeDasharray="40 30" vectorEffect="non-scaling-stroke" pointerEvents="none" />
    <circle cx={handle.x} cy={-handle.y} r="180" fill="transparent" />
    <circle cx={handle.x} cy={-handle.y} r="90" fill="#fff8e6" stroke="#b67c35" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    <text x={handle.x} y={-handle.y + 40} textAnchor="middle" fontSize="110" pointerEvents="none">↻</text>
  </g>;
}
