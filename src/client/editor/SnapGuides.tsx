import { centrelineSpan, type SnapGuide, type StageCentreline } from '../../shared/snapping.js';
import type { PointerEvent } from 'react';

export function CentrelineMark({ centreline, selected, showLabel = true, onPointerDown }: {
  centreline?: StageCentreline;
  selected?: boolean;
  showLabel?: boolean;
  onPointerDown?: (event: PointerEvent<SVGGElement>) => void;
}) {
  if (!centreline) return null;
  const span = centrelineSpan(centreline);
  return <g data-testid="stage-centreline" className={onPointerDown ? 'draggable-wall' : undefined}
    pointerEvents={onPointerDown ? undefined : 'none'}
    onPointerDown={onPointerDown}>
    <line x1={span.a.x} y1={-span.a.y} x2={span.b.x} y2={-span.b.y}
      stroke={selected ? '#b67c35' : '#986122'} strokeWidth={selected ? 4 : 2} strokeDasharray="120 80" vectorEffect="non-scaling-stroke" />
    <circle cx={centreline.x} cy={-centreline.y} r="80" fill={selected ? '#b67c35' : '#986122'} />
    {showLabel && <text x={centreline.x} y={-centreline.y - 80} textAnchor="middle" fontSize="140" pointerEvents="none">Mittellinie</text>}
  </g>;
}

export function AlignmentGuides({ guides }: { guides: SnapGuide[] }) {
  if (!guides.length) return null;
  return <g data-testid="alignment-guides" pointerEvents="none">
    {guides.map((guide, index) => guide.kind === 'wall-anchor'
      ? <g key={index} data-kind={guide.kind}>
        <line x1={guide.a.x} y1={-guide.a.y} x2={guide.b.x} y2={-guide.b.y}
          stroke="#b67c35" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <circle cx={(guide.a.x + guide.b.x) / 2} cy={-(guide.a.y + guide.b.y) / 2} r="60"
          fill="none" stroke="#b67c35" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </g>
      : <line key={index} data-kind={guide.kind}
        x1={guide.a.x} y1={-guide.a.y} x2={guide.b.x} y2={-guide.b.y}
        stroke="#b67c35" strokeWidth="3" strokeDasharray="40 40" vectorEffect="non-scaling-stroke" />)}
  </g>;
}

export function SnapToggle({ enabled, onChange }: { enabled: boolean; onChange: (value: boolean) => void }) {
  return <label className="snap-toggle">
    <input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked)} />
    Einrasten
  </label>;
}
