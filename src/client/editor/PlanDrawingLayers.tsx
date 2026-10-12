import type { PointerEvent } from 'react';
import type { Layout, VenueGeometry, Wall } from '../../shared/layout.js';
import { measuredOutline } from '../../shared/venue.js';
import { resolveWall, isDoorOpening, doorOpenAngleDegrees, type WallElementType } from '../../shared/wall-types.js';
import { effectiveVenueDoorOpen } from '../../shared/venueFixtures.js';
import { defaultPlanDisplay, type PlanDisplayOptions } from '../../shared/planDisplay.js';
import { WallIdentity } from './ConstructionMarks.js';

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

export function PlanWalls({ shown, wallTypes, selected, groupedIds = new Set<string>(), overlapIds = new Set<string>(), readOnly = true, planDisplay = defaultPlanDisplay, panelLabels = {}, start = () => {} }: {
  shown: Layout; wallTypes: WallElementType[]; selected?: string; groupedIds?: Set<string>; overlapIds?: ReadonlySet<string>;
  readOnly?: boolean; planDisplay?: PlanDisplayOptions; panelLabels?: Record<string, string>;
  start?: (event: PointerEvent<SVGGElement>, wall: Wall) => void;
}) {
  return <>
        {shown.walls.map(wall => {
          const resolved = resolveWall(wall, wallTypes);
          const chosen = selected === wall.id || groupedIds.has(`wall:${wall.id}`);
          const overlap = overlapIds.has(wall.id);
          return <g key={wall.id} data-print-layer="walls" data-print-name={wall.label} data-testid={`wall-${wall.id}`} aria-label={wall.label}
            className={[readOnly ? '' : 'draggable-wall', overlap ? 'plan-overlap' : ''].filter(Boolean).join(' ') || undefined}
            transform={`translate(${wall.x} ${-wall.y}) rotate(${-wall.rotation})`} onPointerDown={event => start(event, wall)}>
            <line x1={-resolved.width / 2} x2={resolved.width / 2} stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" />
            <rect x={-resolved.width / 2} y={-resolved.thickness / 2} width={resolved.width} height={resolved.thickness} fill={selected === wall.id ? '#b67c35' : chosen ? '#8a6a3a' : '#315d49'} stroke={chosen ? '#986122' : '#315d49'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {resolved.openings.map(opening => {
              const x0 = -resolved.width / 2 + opening.left;
              const open = isDoorOpening(opening) ? doorOpenAngleDegrees(wall.doorOpenPercent ?? 0) * Math.PI / 180 : 0;
              const hingeX = isDoorOpening(opening)
                ? (opening.hinge === 'left' ? x0 : x0 + opening.width)
                : x0;
              const dir = isDoorOpening(opening) && opening.hinge === 'right' ? -1 : 1;
              const leafEndX = hingeX + dir * opening.width * Math.cos(open);
              const leafEndY = opening.width * Math.sin(open);
              return <g key={opening.id}>
                <rect data-testid={`plan-opening-${opening.id}`} data-width={opening.width} data-height={opening.height} data-left={opening.left} data-sill={opening.sill}
                  data-hinge={opening.hinge ?? ''}
                  x={x0} y={-resolved.thickness / 2} width={opening.width} height={resolved.thickness} fill="#f8faf5" stroke={chosen ? '#986122' : '#315d49'} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {isDoorOpening(opening) && <>
                  <line data-testid={`plan-door-leaf-${opening.id}`} x1={hingeX} y1={0} x2={leafEndX} y2={leafEndY}
                    stroke="#c8c4b8" strokeWidth="28" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                  <circle cx={hingeX} cy={0} r={18} fill="#986122" />
                </>}
              </g>;
            })}
            {planDisplay.showObjectNames && <WallIdentity rotation={wall.rotation} assemblyNumber={wall.assemblyNumber} plate={wall.panelId ? panelLabels[wall.panelId] : undefined} testId={`assembly-label-${wall.id}`} />}
            {planDisplay.showTexts && <>
              <text y={resolved.thickness / 2 + 90} textAnchor="middle" fontSize="110" pointerEvents="none">V</text>
              <text y={-resolved.thickness / 2 - 40} textAnchor="middle" fontSize="110" pointerEvents="none">R</text>
            </>}
          </g>;
        })}
  </>;
}

