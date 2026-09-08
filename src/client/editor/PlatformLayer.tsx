import { type Platform, type StairUnit, type SupportingSurface } from '../../shared/levels.js';
import { platformCentroid } from '../../shared/levels.js';
import type { PointerEvent } from 'react';

function path(outline: { x: number; y: number }[]) {
  return `${outline.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`;
}

export function PlatformLayer({
  venuePlatforms, layoutPlatforms, venueStairs, layoutStairs, selectedId, selectedPlatformIds, selectedMemberIds,
  readOnly, onSelect, onPlatformPointerDown, onStairPointerDown,
}: {
  venuePlatforms: Platform[]; layoutPlatforms: Platform[];
  venueStairs: StairUnit[]; layoutStairs: StairUnit[];
  selectedId?: string; selectedPlatformIds?: string[]; selectedMemberIds?: Set<string>;
  readOnly?: boolean;
  onSelect: (kind: 'platform' | 'stair', id: string, additive?: boolean) => void;
  onPlatformPointerDown?: (event: PointerEvent<SVGGElement>, platform: Platform) => void;
  onStairPointerDown?: (event: PointerEvent<SVGGElement>, stair: StairUnit) => void;
}) {
  const platforms = new Set(selectedPlatformIds ?? []);
  return <g aria-label="Ebenen">
    {venuePlatforms.map(platform => <g key={platform.id} data-testid={`venue-platform-${platform.id}`}>
      <path d={path(platform.outline)} fill="#c5d0b8" stroke="#5a6e52" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      <text x={platform.outline.reduce((sum, point) => sum + point.x, 0) / platform.outline.length}
        y={-platform.outline.reduce((sum, point) => sum + point.y, 0) / platform.outline.length}
        textAnchor="middle" fontSize="160" pointerEvents="none">{platform.label} · {platform.elevation} mm</text>
    </g>)}
    {layoutPlatforms.map(platform => {
      const centre = platformCentroid(platform.outline);
      const chosen = selectedId === platform.id || platforms.has(platform.id);
      return <g key={platform.id} data-testid={`platform-${platform.id}`} className={readOnly ? undefined : 'draggable-wall'}
        onPointerDown={event => {
          if (onPlatformPointerDown) onPlatformPointerDown(event, platform);
          else { event.stopPropagation(); onSelect('platform', platform.id, event.shiftKey); }
        }}>
        <path d={path(platform.outline)} fill={chosen ? '#b7c6a6' : '#c5d0b8'}
          stroke={chosen ? '#b67c35' : '#5a6e52'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text x={centre.x} y={-centre.y} textAnchor="middle" fontSize="160" pointerEvents="none">{platform.label} · {platform.elevation} mm</text>
      </g>;
    })}
    {[...venueStairs.map(stair => ({ stair, movable: false })), ...layoutStairs.map(stair => ({ stair, movable: true }))].map(({ stair, movable }) => {
      const chosen = selectedId === stair.id || !!selectedMemberIds?.has(`stair:${stair.id}`);
      return <g key={stair.id} data-testid={`${movable ? 'stair' : 'venue-stair'}-${stair.id}`} className={movable ? 'draggable-wall' : undefined}
        transform={`translate(${stair.x} ${-stair.y}) rotate(${-stair.rotation})`}
        onPointerDown={movable ? event => {
          if (onStairPointerDown) onStairPointerDown(event, stair);
          else { event.stopPropagation(); onSelect('stair', stair.id, event.shiftKey); }
        } : undefined}>
        <rect x={-stair.width / 2} y={-stair.run / 2} width={stair.width} height={stair.run}
          fill={chosen ? '#d5decc' : '#e8efe3'} stroke={chosen ? '#b67c35' : '#718469'}
          strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text y="40" textAnchor="middle" fontSize="140" pointerEvents="none">{stair.label}</text>
        <text y="200" textAnchor="middle" fontSize="120" pointerEvents="none">{stair.width} × {stair.run} mm</text>
      </g>;
    })}
  </g>;
}

export function SurfaceField({ id, value, surfaces }: { id: string; value?: string; surfaces: SupportingSurface[] }) {
  return <>
    <label htmlFor={id}>Auflagefläche</label>
    <select id={id} name="supportingSurfaceId" defaultValue={value ?? ''}>
      <option value="">Bitte wählen</option>
      {surfaces.map(surface => <option key={surface.id} value={surface.id}>{surface.label} ({surface.elevation} mm)</option>)}
    </select>
  </>;
}
