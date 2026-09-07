import { centrelineSpan, type SnapGuide, type StageCentreline } from '../../shared/snapping.js';

export function CentrelineMark({ centreline }: { centreline?: StageCentreline }) {
  if (!centreline) return null;
  const span = centrelineSpan(centreline);
  return <g data-testid="stage-centreline" pointerEvents="none">
    <line x1={span.a.x} y1={-span.a.y} x2={span.b.x} y2={-span.b.y}
      stroke="#986122" strokeWidth="2" strokeDasharray="120 80" vectorEffect="non-scaling-stroke" />
    <text x={centreline.x} y={-centreline.y - 80} textAnchor="middle" fontSize="140">Mittellinie</text>
  </g>;
}

export function AlignmentGuides({ guides }: { guides: SnapGuide[] }) {
  if (!guides.length) return null;
  return <g data-testid="alignment-guides" pointerEvents="none">
    {guides.map((guide, index) => <line key={index} data-kind={guide.kind}
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
