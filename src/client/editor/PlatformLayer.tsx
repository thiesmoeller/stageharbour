import { type Platform, type StairUnit, type SupportingSurface, platformBounds, platformCentroid } from '../../shared/levels.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';
import { layoutStageDeckModules } from '../../shared/stageDeck.js';
import type { PointerEvent } from 'react';

function path(outline: { x: number; y: number }[]) {
  return `${outline.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`;
}

function platformCaption(platform: Platform, display: PlanDisplayOptions) {
  return [
    display.showObjectNames ? platform.label : undefined,
    display.showDimensions ? `${platform.elevation} mm` : undefined,
  ].filter(Boolean).join(' · ');
}

function outlinePlanRotation(outline: Platform['outline']) {
  const a = outline[0], b = outline[1];
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function StageDeckSeams({ platform }: { platform: Platform }) {
  if ((platform.style ?? 'floating') !== 'stageDeck') return null;
  const centre = platformCentroid(platform.outline);
  const rotation = outlinePlanRotation(platform.outline);
  const bounds = platformBounds(platform.outline);
  const modules = layoutStageDeckModules(bounds.width, bounds.depth);
  return <g transform={`translate(${centre.x} ${-centre.y}) rotate(${-rotation * 180 / Math.PI})`} pointerEvents="none">
    {modules.map((module, index) => <rect key={index}
      x={module.x - module.width / 2} y={-(module.y + module.depth / 2)}
      width={module.width} height={module.depth}
      fill="none" stroke="#5a6e52" strokeWidth="1.5" strokeDasharray="40 30" vectorEffect="non-scaling-stroke" />)}
  </g>;
}

function platformFill(platform: Platform, chosen: boolean) {
  const style = platform.style ?? 'floating';
  if (style === 'solid') return chosen ? 'rgba(113,132,105,0.55)' : 'rgba(113,132,105,0.4)';
  if (style === 'stageDeck') return chosen ? 'rgba(182,124,53,0.35)' : 'rgba(197,208,184,0.55)';
  return chosen ? 'rgba(182,124,53,0.35)' : 'rgba(113,132,105,0.25)';
}

export function PlatformLayer({
  venuePlatforms, layoutPlatforms, venueStairs, layoutStairs, selectedId, selectedPlatformIds, selectedMemberIds,
  readOnly, display = defaultPlanDisplay, onSelect, onPlatformPointerDown, onStairPointerDown,
}: {
  venuePlatforms: Platform[]; layoutPlatforms: Platform[];
  venueStairs: StairUnit[]; layoutStairs: StairUnit[];
  selectedId?: string; selectedPlatformIds?: string[]; selectedMemberIds?: Set<string>;
  readOnly?: boolean;
  display?: PlanDisplayOptions;
  onSelect: (kind: 'platform' | 'stair', id: string, additive?: boolean) => void;
  onPlatformPointerDown?: (event: PointerEvent<SVGGElement>, platform: Platform) => void;
  onStairPointerDown?: (event: PointerEvent<SVGGElement>, stair: StairUnit) => void;
}) {
  const platforms = new Set(selectedPlatformIds ?? []);
  return <g aria-label="Ebenen">
    {venuePlatforms.map(platform => {
      const caption = platformCaption(platform, display);
      return <g key={platform.id} data-testid={`venue-platform-${platform.id}`}>
        <path d={path(platform.outline)} fill={platformFill(platform, false)} stroke="#5a6e52" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <StageDeckSeams platform={platform} />
        {caption && <text x={platform.outline.reduce((sum, point) => sum + point.x, 0) / platform.outline.length}
          y={-platform.outline.reduce((sum, point) => sum + point.y, 0) / platform.outline.length}
          textAnchor="middle" fontSize="160" pointerEvents="none">{caption}</text>}
      </g>;
    })}
    {layoutPlatforms.map(platform => {
      const centre = platformCentroid(platform.outline);
      const chosen = selectedId === platform.id || platforms.has(platform.id);
      const caption = platformCaption(platform, display);
      return <g key={platform.id} data-testid={`platform-${platform.id}`} className={readOnly ? undefined : 'draggable-wall'}
        onPointerDown={event => {
          if (onPlatformPointerDown) onPlatformPointerDown(event, platform);
          else { event.stopPropagation(); onSelect('platform', platform.id, event.shiftKey); }
        }}>
        <path d={path(platform.outline)} fill={platformFill(platform, chosen)}
          stroke={chosen ? '#b67c35' : '#5a6e52'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <StageDeckSeams platform={platform} />
        {caption && <text x={centre.x} y={-centre.y} textAnchor="middle" fontSize="160" pointerEvents="none">{caption}</text>}
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
        {display.showObjectNames && <text y="40" textAnchor="middle" fontSize="140" pointerEvents="none">{stair.label}</text>}
        {display.showDimensions && <text y="200" textAnchor="middle" fontSize="120" pointerEvents="none">{stair.width} × {stair.run} mm</text>}
      </g>;
    })}
  </g>;
}

export function SurfaceField({ id, value, surfaces }: { id: string; value?: string; surfaces: SupportingSurface[] }) {
  const surface = surfaces.find(item => item.id === value) ?? surfaces.find(item => item.elevation === 0);
  return <>
    <label htmlFor={id}>Auflagefläche</label>
    <input id={id} type="text" readOnly
      value={surface ? `${surface.label} (${surface.elevation} mm)` : 'Zuschauerboden (0 mm)'}
      title="Automatisch nach Abdeckung: Boden oder oberstes Podest unter dem Objekt" />
    <p className="muted">Automatisch nach dem größeren Teil der Abdeckung. Mehrstufige Podeste: jeweils die oberste Fläche.</p>
  </>;
}
