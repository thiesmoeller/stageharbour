import { type Platform, type StairUnit, type SupportingSurface } from '../../shared/levels.js';

function path(outline: { x: number; y: number }[]) {
  return `${outline.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`;
}

export function PlatformLayer({
  venuePlatforms, layoutPlatforms, venueStairs, layoutStairs, selectedId, onSelect,
}: {
  venuePlatforms: Platform[]; layoutPlatforms: Platform[];
  venueStairs: StairUnit[]; layoutStairs: StairUnit[];
  selectedId?: string; onSelect: (kind: 'platform' | 'stair', id: string) => void;
}) {
  return <g aria-label="Ebenen">
    {venuePlatforms.map(platform => <g key={platform.id} data-testid={`venue-platform-${platform.id}`}>
      <path d={path(platform.outline)} fill="#c5d0b8" stroke="#5a6e52" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      <text x={platform.outline.reduce((sum, point) => sum + point.x, 0) / platform.outline.length}
        y={-platform.outline.reduce((sum, point) => sum + point.y, 0) / platform.outline.length}
        textAnchor="middle" fontSize="160" pointerEvents="none">{platform.label} · {platform.elevation} mm</text>
    </g>)}
    {layoutPlatforms.map(platform => {
      const cx = platform.outline.reduce((sum, point) => sum + point.x, 0) / platform.outline.length;
      const cy = platform.outline.reduce((sum, point) => sum + point.y, 0) / platform.outline.length;
      return <g key={platform.id} data-testid={`platform-${platform.id}`} className="draggable-wall" onPointerDown={event => { event.stopPropagation(); onSelect('platform', platform.id); }}>
        <path d={path(platform.outline)} fill={selectedId === platform.id ? '#b7c6a6' : '#c5d0b8'}
          stroke={selectedId === platform.id ? '#b67c35' : '#5a6e52'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text x={cx} y={-cy} textAnchor="middle" fontSize="160" pointerEvents="none">{platform.label} · {platform.elevation} mm</text>
      </g>;
    })}
    {[...venueStairs.map(stair => ({ stair, movable: false })), ...layoutStairs.map(stair => ({ stair, movable: true }))].map(({ stair, movable }) => (
      <g key={stair.id} data-testid={`${movable ? 'stair' : 'venue-stair'}-${stair.id}`} className={movable ? 'draggable-wall' : undefined}
        transform={`translate(${stair.x} ${-stair.y}) rotate(${-stair.rotation})`}
        onPointerDown={movable ? event => { event.stopPropagation(); onSelect('stair', stair.id); } : undefined}>
        <rect x={-stair.width / 2} y={-stair.run / 2} width={stair.width} height={stair.run}
          fill={selectedId === stair.id ? '#d5decc' : '#e8efe3'} stroke={selectedId === stair.id ? '#b67c35' : '#718469'}
          strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text y="40" textAnchor="middle" fontSize="140" pointerEvents="none">{stair.label}</text>
        <text y="200" textAnchor="middle" fontSize="120" pointerEvents="none">{stair.width} × {stair.run} mm</text>
      </g>
    ))}
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
