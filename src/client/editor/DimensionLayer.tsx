import type { PlanPoint } from '../../shared/venue.js';
import { dimensionFigure, type ResolvedDimension } from '../../shared/dimensions.js';

function readableAngle(lineY1: number, lineY2: number, lineX1: number, lineX2: number) {
  let degrees = Math.atan2(-(lineY2 - lineY1), lineX2 - lineX1) * 180 / Math.PI;
  if (degrees > 90 || degrees < -90) degrees += 180;
  return degrees;
}

export function DimensionLayer({ dimensions, preview, selectedId, snaps, snapRadius = 120, passPointer = false, onSelect }: {
  dimensions: readonly ResolvedDimension[];
  preview?: ResolvedDimension;
  selectedId?: string;
  snaps?: readonly PlanPoint[];
  /** Screen-sized radius, in plan millimetres. */
  snapRadius?: number;
  /** Let clicks fall through to the placement target underneath. */
  passPointer?: boolean;
  onSelect?: (id: string) => void;
}) {
  const drawn = preview ? [...dimensions, preview] : dimensions;
  return <g className="dimension-layer" pointerEvents={passPointer ? 'none' : undefined}>
    {drawn.map(dimension => {
      const figure = dimensionFigure(dimension);
      const selected = dimension.id === selectedId || dimension.id === 'preview';
      const text = `${Math.round(figure.valueMm)} mm`;
      const angle = readableAngle(figure.line.y1, figure.line.y2, figure.line.x1, figure.line.x2);
      return <g key={dimension.id} data-testid={`dimension-${dimension.id}`} className={selected ? 'dimension-selected' : undefined}
        onPointerDown={event => { if (!onSelect || dimension.id === 'preview') return; event.stopPropagation(); onSelect(dimension.id); }}>
        {figure.extensions.map((segment, index) => <line key={index} x1={segment.x1} y1={-segment.y1} x2={segment.x2} y2={-segment.y2} className="dimension-extension" />)}
        <line x1={figure.line.x1} y1={-figure.line.y1} x2={figure.line.x2} y2={-figure.line.y2} className="dimension-line" />
        {figure.ticks.map((segment, index) => <line key={index} x1={segment.x1} y1={-segment.y1} x2={segment.x2} y2={-segment.y2} className="dimension-tick" />)}
        <text x={figure.label.x} y={-figure.label.y} textAnchor="middle" fontSize="220" fontWeight={700} className="dimension-text"
          transform={`rotate(${angle} ${figure.label.x} ${-figure.label.y})`} dy={-160}>{text}</text>
      </g>;
    })}
    {snaps?.map((point, index) => <g key={`${point.x}:${point.y}:${index}`} className="dimension-snap" data-testid="dimension-snap" transform={`translate(${point.x} ${-point.y})`} pointerEvents="none">
      <circle r={snapRadius} />
      <circle r={snapRadius * 0.38} />
    </g>)}
  </g>;
}
