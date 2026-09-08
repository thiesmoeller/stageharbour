import type { PointerEvent } from 'react';
import type { Brace } from '../../shared/layout.js';

export function BraceLayer({ braces, selectedId, groupedIds, preview, readOnly, onPointerDown }: {
  braces: Brace[]; selectedId?: string; groupedIds?: Set<string>; preview?: Brace; readOnly: boolean;
  onPointerDown: (event: PointerEvent<SVGGElement>, brace: Brace) => void;
}) {
  return braces.map(saved => {
    const brace = preview?.id === saved.id ? preview : saved;
    const chosen = selectedId === brace.id || !!groupedIds?.has(`brace:${brace.id}`);
    return <g key={brace.id} data-testid={`brace-${brace.id}`} aria-label={brace.label} className={readOnly ? '' : 'draggable-wall'}
      transform={`translate(${brace.x} ${-brace.y}) rotate(${-brace.rotation})`} onPointerDown={event => onPointerDown(event, brace)}>
      <rect x={-brace.footprintWidth / 2} y={-brace.footprintDepth / 2} width={brace.footprintWidth} height={brace.footprintDepth}
        fill={chosen ? '#e4d3b0' : '#eddcc0'} stroke={chosen ? '#8a6a3a' : '#a48454'}
        strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polygon points={`${-brace.footprintWidth / 2},${-brace.footprintDepth / 2} ${brace.footprintWidth / 2},${-brace.footprintDepth / 2} 0,${brace.footprintDepth / 2}`}
        fill="#c4a57466" stroke="#8a6a3a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text y="-140" textAnchor="middle" fontSize="150" pointerEvents="none">{brace.label}</text>
      <text y="200" textAnchor="middle" fontSize="130" pointerEvents="none">{brace.footprintWidth} × {brace.footprintDepth} mm</text>
      <text y="350" textAnchor="middle" fontSize="130" pointerEvents="none">{brace.height} mm</text>
    </g>;
  });
}
