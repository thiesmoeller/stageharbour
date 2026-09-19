import type { PointerEvent } from 'react';
import type { Brace } from '../../shared/layout.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';

export function BraceLayer({ braces, selectedId, groupedIds, preview, readOnly, display = defaultPlanDisplay, onPointerDown }: {
  braces: Brace[]; selectedId?: string; groupedIds?: Set<string>; preview?: Brace; readOnly: boolean;
  display?: PlanDisplayOptions;
  onPointerDown: (event: PointerEvent<SVGGElement>, brace: Brace) => void;
}) {
  return braces.map(saved => {
    const brace = preview?.id === saved.id ? preview : saved;
    const chosen = selectedId === brace.id || !!groupedIds?.has(`brace:${brace.id}`);
    const halfW = brace.footprintWidth / 2;
    const halfD = brace.footprintDepth / 2;
    return <g key={brace.id} data-testid={`brace-${brace.id}`} aria-label={brace.label} className={readOnly ? '' : 'draggable-wall'}
      transform={`translate(${brace.x} ${-brace.y}) rotate(${-brace.rotation})`} onPointerDown={event => onPointerDown(event, brace)}>
      <rect x={-halfW} y={-halfD} width={brace.footprintWidth} height={brace.footprintDepth}
        fill={chosen ? '#e4d3b0' : '#eddcc0'} stroke={chosen ? '#8a6a3a' : '#a48454'}
        strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {/* Wall face at local −Y; floor tip at +Y. */}
      <line x1={-halfW} y1={-halfD} x2={halfW} y2={-halfD} stroke="#8a6a3a" strokeWidth="4" vectorEffect="non-scaling-stroke" />
      <line x1={0} y1={-halfD} x2={0} y2={halfD} stroke="#a48454" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {display.showObjectNames && <text y={-halfD - 80} textAnchor="middle" fontSize="150" pointerEvents="none">{brace.label}</text>}
      {display.showDimensions && <>
        <text y={halfD + 160} textAnchor="middle" fontSize="130" pointerEvents="none">{brace.footprintWidth} × {brace.footprintDepth} mm</text>
        <text y={halfD + 310} textAnchor="middle" fontSize="130" pointerEvents="none">{brace.height} mm</text>
      </>}
    </g>;
  });
}
