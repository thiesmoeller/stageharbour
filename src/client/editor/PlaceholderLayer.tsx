import type { PointerEvent } from 'react';
import { PLACEHOLDER_KIND_LABELS, type Placeholder } from '../../shared/placeholders.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';

const fill: Record<Placeholder['kind'], string> = {
  table: '#7d8f6c', chair: '#8fa07a', person: '#c4a574', speaker: '#6a7d92', box: '#a09070',
};

export function PlaceholderLayer({ placeholders, selectedId, preview, readOnly, groupedIds, overlappingIds, display = defaultPlanDisplay, onPointerDown }: {
  placeholders: Placeholder[]; selectedId?: string; preview?: Placeholder; readOnly: boolean; groupedIds: Set<string>;
  overlappingIds?: ReadonlySet<string>;
  display?: PlanDisplayOptions;
  onPointerDown: (event: PointerEvent<SVGGElement>, item: Placeholder) => void;
}) {
  return placeholders.map(saved => {
    const item = preview?.id === saved.id ? preview : saved;
    const chosen = selectedId === item.id || groupedIds.has(`placeholder:${item.id}`);
    const overlap = overlappingIds?.has(item.id);
    const w = item.width, d = item.depth;
    return <g key={item.id} data-print-layer={item.kind === 'chair' ? 'audience' : 'objects'} data-print-name={item.label} data-testid={`placeholder-${item.id}`} aria-label={item.label}
      className={[readOnly ? '' : 'draggable-wall', overlap ? 'plan-overlap' : ''].filter(Boolean).join(' ') || undefined}
      transform={`translate(${item.x} ${-item.y}) rotate(${-item.rotation})`} onPointerDown={event => onPointerDown(event, item)}>
      {item.kind === 'chair' ? <>
        <rect x={-w / 2} y={-d / 2} width={w} height={d * 0.55}
          fill={chosen ? fill.chair : `${fill.chair}cc`} stroke={chosen ? '#986122' : '#5a6e52'}
          strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <rect x={-w / 2} y={-d / 2} width={w} height={d * 0.18}
          fill="#6f805f" stroke={chosen ? '#986122' : '#5a6e52'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {item.seatedFigure && <g pointerEvents="none">
          <ellipse cx="0" cy={-d * 0.05} rx={w * 0.22} ry={d * 0.18} fill="#d9c6a1" stroke="#8a6a3a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <circle cy={-d * 0.28} r={Math.min(w, d) * 0.14} fill="#d9c6a1" stroke="#8a6a3a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </g>}
      </> : <>
        <rect x={-w / 2} y={-d / 2} width={w} height={d}
          fill={chosen ? fill[item.kind] : `${fill[item.kind]}cc`} stroke={chosen ? '#986122' : '#5a6e52'}
          strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {item.kind === 'person' && <circle cy={-d / 4} r={Math.min(w, d) / 4}
          fill="#d9c6a1" stroke="#8a6a3a" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      </>}
      {display.showObjectNames && <text y="-140" textAnchor="middle" fontSize="150" pointerEvents="none">{item.label}</text>}
      {display.showDimensions && <text data-print-layer="dimensions" y="200" textAnchor="middle" fontSize="130" pointerEvents="none">{item.width} × {item.depth} mm</text>}
      {display.showTexts && <text y="350" textAnchor="middle" fontSize="110" pointerEvents="none">{PLACEHOLDER_KIND_LABELS[item.kind]}{item.seatedFigure ? ' · Sitzfigur' : ''}</text>}
    </g>;
  });
}
