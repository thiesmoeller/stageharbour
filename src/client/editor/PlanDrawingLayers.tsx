import type { PointerEvent } from 'react';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import type { ResolvedLayoutObject } from '../../shared/layoutObjects.js';
import { measuredOutline } from '../../shared/venue.js';
import { resolveWall, isDoorOpening, doorOpenAngleDegrees } from '../../shared/wall-types.js';
import { effectiveVenueDoorOpen } from '../../shared/venueFixtures.js';
import { defaultPlanDisplay, type PlanDisplayOptions } from '../../shared/planDisplay.js';

type FixtureSelection = { kind: 'curtain' | 'door'; id: string };
export function PlanVenue({ venue, shown, readOnly = true, planDisplay = defaultPlanDisplay, fixtureSelection, pickVenueFixture = () => {}, startMarquee }: {
  venue: VenueGeometry; shown: Layout; readOnly?: boolean; planDisplay?: PlanDisplayOptions;
  fixtureSelection?: FixtureSelection | null; pickVenueFixture?: (value: FixtureSelection) => void;
  startMarquee?: (event: PointerEvent<Element>) => void;
}) {
  const floor = measuredOutline(venue);
  return <>
        <path data-print-layer="venue" data-testid="venue-floor" d={`${floor.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill="url(#metre-grid)" stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke" onPointerDown={startMarquee} />
        {(venue.walls ?? []).map(wall => {
          const resolved = resolveWall(wall, venue.wallTypes ?? []);
          const hasDoor = resolved.openings.some(isDoorOpening);
          const chosen = fixtureSelection?.kind === 'door' && fixtureSelection.id === wall.id;
          const doorOpen = effectiveVenueDoorOpen(wall, shown);
          return <g key={wall.id} data-print-layer="venue" data-print-name={wall.label} data-testid={`venue-wall-${wall.id}`}
            className={hasDoor && !readOnly ? 'draggable-wall' : undefined}
            transform={`translate(${wall.x} ${-wall.y}) rotate(${-wall.rotation})`}
            pointerEvents={hasDoor ? 'all' : 'none'}
            onPointerDown={hasDoor ? event => {
              if (event.button !== 0) return;
              event.stopPropagation();
              pickVenueFixture({ kind: 'door', id: wall.id });
            } : undefined}>
            <rect x={-resolved.width / 2} y={-resolved.thickness / 2} width={resolved.width} height={resolved.thickness}
              fill={chosen ? '#a89880' : '#8b8478'} stroke={chosen ? '#b67c35' : '#625b50'} strokeWidth={chosen ? 2 : 1}
              vectorEffect="non-scaling-stroke" />
            {resolved.openings.map(opening => {
              const x0 = -resolved.width / 2 + opening.left;
              const open = isDoorOpening(opening) ? doorOpenAngleDegrees(doorOpen) * Math.PI / 180 : 0;
              const hingeX = isDoorOpening(opening)
                ? (opening.hinge === 'left' ? x0 : x0 + opening.width)
                : x0;
              const dir = isDoorOpening(opening) && opening.hinge === 'right' ? -1 : 1;
              const leafEndX = hingeX + dir * opening.width * Math.cos(open);
              const leafEndY = opening.width * Math.sin(open);
              return <g key={opening.id}>
                <rect x={x0} y={-resolved.thickness / 2} width={opening.width} height={resolved.thickness}
                  fill="#f8faf5" stroke={chosen ? '#b67c35' : '#625b50'} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {isDoorOpening(opening) && <>
                  <line data-testid={`venue-door-leaf-${opening.id}`} x1={hingeX} y1={0} x2={leafEndX} y2={leafEndY}
                    stroke="#c8c4b8" strokeWidth="28" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                  <circle cx={hingeX} cy={0} r={18} fill="#986122" />
                </>}
              </g>;
            })}
            <title>{wall.label} · feste Spielstättenwand{hasDoor ? ' · Öffnung pro Bühnenbild' : ''}</title>
          </g>;
        })}
        {(venue.placeholders ?? []).map(item => <g key={item.id} data-print-layer="audience" data-print-name={item.label} data-testid={`venue-placeholder-${item.id}`}
          transform={`translate(${item.x} ${-item.y}) rotate(${-item.rotation})`} pointerEvents="none">
          <rect x={-item.width / 2} y={-item.depth / 2} width={item.width} height={item.depth}
            fill="#8fa07a99" stroke="#625b50" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <title>{item.label} · fester Publikumsstuhl</title>
        </g>)}
        {planDisplay.showDimensions && <>
          <text data-print-layer="dimensions" x={venue.width / 2} y={-venue.depth - 200} textAnchor="middle" fontSize="180">{venue.width} mm</text>
          <text data-print-layer="dimensions" x="-170" y={-venue.depth / 2} textAnchor="middle" fontSize="180" transform={`rotate(-90 -170 ${-venue.depth / 2})`}>{venue.depth} mm</text>
        </>}
        {planDisplay.showTexts && <>
          <text data-print-layer="orientation" x={venue.width / 2} y="420" textAnchor="middle" fontSize="190">↑ Publikum · Blick zur Bühne</text>
          <text data-print-layer="orientation" x={venue.width / 2} y="620" textAnchor="middle" fontSize="140">V Vorderseite · R Rückseite</text>
        </>}
  </>;
}

export function PlanObjects({ objects, selectedIds = new Set<string>(), overlapIds = new Set<string>(), readOnly = true, planDisplay = defaultPlanDisplay, start = () => {} }: {
  objects: readonly ResolvedLayoutObject[];
  selectedIds?: ReadonlySet<string>; overlapIds?: ReadonlySet<string>;
  readOnly?: boolean; planDisplay?: PlanDisplayOptions;
  start?: (event: PointerEvent<SVGGElement>, object: ResolvedLayoutObject) => void;
}) {
  return <>
        {objects.map(object => {
          const chosen = selectedIds.has(object.object.id);
          const overlap = overlapIds.has(object.object.id);
          const points = object.footprint.map(point => `${point.x},${-point.y}`).join(' ');
          const centre = object.footprint.reduce((sum, point) => ({
            x: sum.x + point.x / object.footprint.length,
            y: sum.y + point.y / object.footprint.length,
          }), { x: 0, y: 0 });
          return <g key={object.object.id} data-print-layer="objects" data-print-name={object.object.label}
            data-testid={`object-${object.object.id}`} aria-label={object.object.label}
            className={[readOnly ? '' : 'draggable-wall', overlap ? 'plan-overlap' : ''].filter(Boolean).join(' ') || undefined}
            onPointerDown={event => start(event, object)}>
            <polygon points={points} fill={chosen ? '#b67c35' : '#315d49'} fillOpacity={0.75}
              stroke={chosen ? '#986122' : '#234638'} strokeWidth={chosen ? 4 : 2} vectorEffect="non-scaling-stroke" />
            {object.resolved.planSymbol === 'stair' && <line x1={object.bounds.min.x} y1={-object.bounds.min.z}
              x2={object.bounds.max.x} y2={-object.bounds.max.z} stroke="#f8faf5" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
            {planDisplay.showObjectNames && <text x={centre.x} y={-centre.y - 70} textAnchor="middle" fontSize="110"
              pointerEvents="none">{object.object.assemblyNumber ? `${object.object.assemblyNumber} · ` : ''}{object.object.label}</text>}
            <title>{object.object.label}</title>
          </g>;
        })}
  </>;
}

