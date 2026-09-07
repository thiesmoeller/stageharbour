import type { PointerEvent } from 'react';
import { PLACEHOLDER_KIND_LABELS, type Placeholder } from '../../shared/placeholders.js';

const fill: Record<Placeholder['kind'], string> = {
  table: '#7d8f6c', chair: '#8fa07a', person: '#c4a574', speaker: '#6a7d92', box: '#a09070',
};

export function PlaceholderLayer({ placeholders, selectedId, preview, readOnly, groupedIds, onPointerDown }: {
  placeholders: Placeholder[]; selectedId?: string; preview?: Placeholder; readOnly: boolean; groupedIds: Set<string>;
  onPointerDown: (event: PointerEvent<SVGGElement>, item: Placeholder) => void;
}) {
  return placeholders.map(saved => {
    const item = preview?.id === saved.id ? preview : saved;
    const chosen = selectedId === item.id || groupedIds.has(`placeholder:${item.id}`);
    return <g key={item.id} data-testid={`placeholder-${item.id}`} aria-label={item.label} className={readOnly ? '' : 'draggable-wall'}
      transform={`translate(${item.x} ${-item.y}) rotate(${-item.rotation})`} onPointerDown={event => onPointerDown(event, item)}>
      <rect x={-item.width / 2} y={-item.depth / 2} width={item.width} height={item.depth}
        fill={chosen ? fill[item.kind] : `${fill[item.kind]}cc`} stroke={chosen ? '#986122' : '#5a6e52'}
        strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {item.kind === 'person' && <circle cy={-item.depth / 4} r={Math.min(item.width, item.depth) / 4}
        fill="#d9c6a1" stroke="#8a6a3a" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      <text y="-140" textAnchor="middle" fontSize="150" pointerEvents="none">{item.label}</text>
      <text y="200" textAnchor="middle" fontSize="130" pointerEvents="none">{item.width} × {item.depth} mm</text>
      <text y="350" textAnchor="middle" fontSize="110" pointerEvents="none">{PLACEHOLDER_KIND_LABELS[item.kind]}</text>
    </g>;
  });
}
