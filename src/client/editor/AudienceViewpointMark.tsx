import type { PointerEvent } from 'react';
import type { AudienceViewpoint } from '../../shared/venue.js';

/** Interactive Publikumssicht camera + aim target on the venue plan (Y flipped for SVG). */
export function AudienceViewpointMark({
  viewpoint, selected, showLabel = true, onOriginPointerDown, onTargetPointerDown,
}: {
  viewpoint: AudienceViewpoint;
  selected?: boolean;
  showLabel?: boolean;
  onOriginPointerDown?: (event: PointerEvent<SVGGElement>) => void;
  onTargetPointerDown?: (event: PointerEvent<SVGCircleElement>) => void;
}) {
  const color = selected ? '#b67c35' : '#536950';
  const dx = viewpoint.targetX - viewpoint.x;
  const dy = viewpoint.targetY - viewpoint.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const coneLen = Math.min(1800, Math.max(600, length * 0.45));
  const half = coneLen * 0.28;
  const tip = { x: viewpoint.x + ux * coneLen, y: viewpoint.y + uy * coneLen };
  const left = { x: tip.x - uy * half, y: tip.y + ux * half };
  const right = { x: tip.x + uy * half, y: tip.y - ux * half };
  const label = viewpoint.label?.trim() || 'Publikumssicht';
  return <g data-print-layer="orientation" data-testid="audience-viewpoint"
    className={onOriginPointerDown ? 'draggable-wall' : undefined}
    pointerEvents={onOriginPointerDown || onTargetPointerDown ? undefined : 'none'}>
    <polygon
      points={`${viewpoint.x},${-viewpoint.y} ${left.x},${-left.y} ${right.x},${-right.y}`}
      fill={color} fillOpacity={selected ? 0.18 : 0.1} stroke={color} strokeOpacity={0.55}
      strokeWidth={1.5} strokeDasharray="18 12" vectorEffect="non-scaling-stroke" pointerEvents="none" />
    <line x1={viewpoint.x} y1={-viewpoint.y} x2={viewpoint.targetX} y2={-viewpoint.targetY}
      stroke={color} strokeOpacity={0.7} strokeWidth={selected ? 2 : 1.25}
      strokeDasharray="20 14" vectorEffect="non-scaling-stroke" pointerEvents="none" />
    <g onPointerDown={onOriginPointerDown} data-testid="audience-viewpoint-origin">
      <circle cx={viewpoint.x} cy={-viewpoint.y} r="90" fill={color} fillOpacity={selected ? 0.95 : 0.7} />
      <circle cx={viewpoint.x} cy={-viewpoint.y} r="36" fill="#f7faf4" />
      <path d={`M ${viewpoint.x - 28} ${-viewpoint.y - 8} L ${viewpoint.x} ${-viewpoint.y - 40} L ${viewpoint.x + 28} ${-viewpoint.y - 8} Z`}
        fill={color} pointerEvents="none" />
    </g>
    <circle data-testid="audience-viewpoint-target"
      cx={viewpoint.targetX} cy={-viewpoint.targetY} r="55"
      fill="#f7faf4" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke"
      onPointerDown={onTargetPointerDown} />
    {showLabel && <text x={viewpoint.x} y={-viewpoint.y - 120} textAnchor="middle" fontSize="48"
      fill={color} fillOpacity={0.85} pointerEvents="none">{label}</text>}
  </g>;
}
