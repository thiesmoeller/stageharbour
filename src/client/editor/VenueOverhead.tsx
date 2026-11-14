import { EXAMPLE_CEILING_HEIGHT, newOverheadBox, overheadBoxCorners, type OverheadBox } from '../../shared/overhead.js';
import { trussCorners, trussHangWorld, type Truss } from '../../shared/truss.js';
import { curtainEndTicks, curtainWavyPoints, type Curtain } from '../../shared/curtains.js';
import type { VenueGeometry } from '../../shared/layout.js';
import type { HangPlan } from '../../shared/hangPlan.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';
import type { PointerEvent } from 'react';

export function OverheadMarks({ boxes, selectedIds = [], display = defaultPlanDisplay, onPointerDown }: {
  boxes: OverheadBox[]; selectedIds?: readonly string[];
  display?: PlanDisplayOptions;
  onPointerDown?: (event: PointerEvent<SVGGElement>, id: string) => void;
}) {
  return <g aria-label="Überbauungen" pointerEvents={onPointerDown ? undefined : 'none'}>
    {boxes.map(box => {
      const corners = overheadBoxCorners(box);
      const chosen = selectedIds.includes(box.id);
      const caption = [
        display.showObjectNames ? box.label : undefined,
        display.showDimensions ? `${box.bottomHeight} mm` : undefined,
      ].filter(Boolean).join(' · ');
      return <g key={box.id} data-print-layer="overhead" data-print-name={box.label} data-testid={`overhead-box-${box.id}`} className={onPointerDown ? 'draggable-wall' : undefined}
        onPointerDown={onPointerDown ? event => onPointerDown(event, box.id) : undefined}>
        <path d={`${corners.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill={chosen ? '#d9c6a166' : '#d9c6a133'} stroke={chosen ? '#b67c35' : '#8a6a3a'} strokeWidth={chosen ? 3 : 2}
          strokeDasharray="80 50" vectorEffect="non-scaling-stroke" />
        {caption && <text x={box.x} y={-box.y} textAnchor="middle" fontSize="140" pointerEvents="none">{caption}</text>}
      </g>;
    })}
  </g>;
}

export function TrussMarks({ trusses, selectedIds = [], drawing, display = defaultPlanDisplay, hangPlan, highlightTrussId, hangPreview, onPointerDown }: {
  trusses: Truss[]; selectedIds?: readonly string[];
  drawing?: { start: { x: number; y: number }; end?: { x: number; y: number } };
  display?: PlanDisplayOptions;
  /** Hang plan fixtures — used for Scheinwerfer markers when showLightingFixtures. */
  hangPlan?: HangPlan;
  /** Traversen snap target while placing a Scheinwerfer. */
  highlightTrussId?: string;
  hangPreview?: { pointer: { x: number; y: number }; snap: { x: number; y: number }; label?: string };
  onPointerDown?: (event: PointerEvent<SVGGElement>, id: string) => void;
}) {
  if (!display.showTrusses && !display.showLightingFixtures && !drawing && !hangPreview) return null;
  const fixtureHangIds = new Set((hangPlan?.fixtures ?? []).map(fixture => fixture.hangPointId));
  return <g aria-label="Traversen" pointerEvents={onPointerDown ? undefined : 'none'}>
    {display.showTrusses && trusses.map(truss => {
      const corners = trussCorners(truss);
      const chosen = selectedIds.includes(truss.id);
      const highlighted = truss.id === highlightTrussId;
      const angle = (truss.rotation ?? 0) * Math.PI / 180;
      const hx = Math.cos(angle) * truss.length / 2, hy = Math.sin(angle) * truss.length / 2;
      const caption = [
        display.showObjectNames ? truss.label : undefined,
        display.showDimensions ? `${truss.bottomHeight} mm` : undefined,
      ].filter(Boolean).join(' · ');
      return <g key={truss.id} data-print-layer="overhead" data-print-name={truss.label} data-testid={`truss-${truss.id}`}
        data-hang-target={highlighted || undefined}
        className={onPointerDown ? 'draggable-wall' : undefined}
        onPointerDown={onPointerDown ? event => onPointerDown(event, truss.id) : undefined}>
        <path d={`${corners.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill={highlighted ? '#c9a22744' : chosen ? '#4f86ba55' : '#4f86ba22'}
          stroke={highlighted ? '#c9a227' : chosen ? '#b67c35' : '#4f86ba'} strokeWidth={highlighted ? 4 : chosen ? 3 : 2}
          strokeDasharray={highlighted ? undefined : '40 30'} vectorEffect="non-scaling-stroke" />
        <line x1={truss.x - hx} y1={-(truss.y - hy)} x2={truss.x + hx} y2={-(truss.y + hy)}
          stroke={highlighted ? '#c9a227' : chosen ? '#b67c35' : '#4f86ba'} strokeWidth={highlighted ? 5 : chosen ? 4 : 3}
          vectorEffect="non-scaling-stroke" />
        {truss.hangPoints.map(hang => {
          const point = trussHangWorld(truss, hang);
          return <circle key={hang.id} cx={point.x} cy={-point.y} r="40" fill="#2f5f8a" pointerEvents="none" />;
        })}
        {caption && <text x={truss.x} y={-truss.y} textAnchor="middle" fontSize="140" pointerEvents="none">{caption}</text>}
      </g>;
    })}
    {display.showLightingFixtures && trusses.flatMap(truss => truss.hangPoints
      .filter(hang => fixtureHangIds.has(hang.id))
      .map(hang => {
        const point = trussHangWorld(truss, hang);
        return <rect key={`light-${hang.id}`} data-testid={`lighting-fixture-mark-${hang.id}`}
          x={point.x - 55} y={-point.y - 55} width="110" height="110"
          fill="#c9a227" stroke="#8a7010" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
      }))}
    {hangPreview && <g data-testid="hang-placement-preview" pointerEvents="none">
      <line x1={hangPreview.pointer.x} y1={-hangPreview.pointer.y} x2={hangPreview.snap.x} y2={-hangPreview.snap.y}
        stroke="#c9a227" strokeWidth="2" strokeDasharray="50 40" vectorEffect="non-scaling-stroke" opacity="0.7" />
      <circle cx={hangPreview.pointer.x} cy={-hangPreview.pointer.y} r="28" fill="#c9a22766" stroke="#8a7010"
        strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <rect x={hangPreview.snap.x - 55} y={-hangPreview.snap.y - 55} width="110" height="110"
        fill="#c9a227aa" stroke="#8a7010" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      <circle cx={hangPreview.snap.x} cy={-hangPreview.snap.y} r="40" fill="#2f5f8a" />
      {hangPreview.label && <text x={hangPreview.snap.x} y={-hangPreview.snap.y - 100} textAnchor="middle"
        fontSize="140" fill="#8a7010">{hangPreview.label}</text>}
    </g>}
    {display.showTrusses && drawing && <g data-testid="truss-drawing" pointerEvents="none">
      <line x1={drawing.start.x} y1={-drawing.start.y} x2={(drawing.end ?? drawing.start).x} y2={-(drawing.end ?? drawing.start).y}
        stroke="#4f86ba" strokeWidth="3" strokeDasharray="40 40" vectorEffect="non-scaling-stroke" />
      <circle cx={drawing.start.x} cy={-drawing.start.y} r="50" fill="#4f86ba" />
    </g>}
  </g>;
}

/** USITT soft-goods plan symbol: sine-wave fullness with end ticks. */
export function CurtainMarks({ curtains, selectedIds = [], drawing, display = defaultPlanDisplay, onPointerDown }: {
  curtains: Curtain[]; selectedIds?: readonly string[];
  drawing?: { start: { x: number; y: number }; end?: { x: number; y: number } };
  display?: PlanDisplayOptions;
  onPointerDown?: (event: PointerEvent<SVGGElement>, id: string) => void;
}) {
  return <g aria-label="Molton-Vorhänge" pointerEvents={onPointerDown ? undefined : 'none'}>
    {curtains.map(curtain => {
      const chosen = selectedIds.includes(curtain.id);
      const waves = curtainWavyPoints(curtain);
      const ticks = curtainEndTicks(curtain);
      const caption = [
        display.showObjectNames ? curtain.label : undefined,
        display.showDimensions ? `${curtain.height} mm` : undefined,
        display.showObjectNames && curtain.openPercent > 0 ? `offen ${Math.round(curtain.openPercent)}%` : undefined,
      ].filter(Boolean).join(' · ');
      const angle = (curtain.rotation ?? 0) * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const half = curtain.length / 2;
      return <g key={curtain.id} data-print-layer="curtains" data-print-name={curtain.label} data-testid={`curtain-${curtain.id}`} className={onPointerDown ? 'draggable-wall' : undefined}
        onPointerDown={onPointerDown ? event => onPointerDown(event, curtain.id) : undefined}>
        {onPointerDown && <line
          x1={curtain.x - half * cos} y1={-(curtain.y - half * sin)}
          x2={curtain.x + half * cos} y2={-(curtain.y + half * sin)}
          stroke="transparent" strokeWidth="80" vectorEffect="non-scaling-stroke" pointerEvents="stroke" />}
        {waves.map((points, index) =>
          <path key={index} d={points.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')}
            fill="none" stroke={chosen ? '#b67c35' : '#2a2a2a'} strokeWidth={chosen ? 3.5 : 2.5}
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
        {ticks.map((tick, index) =>
          <line key={index} x1={tick.a.x} y1={-tick.a.y} x2={tick.b.x} y2={-tick.b.y}
            stroke={chosen ? '#b67c35' : '#1a1a1a'} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
        {caption && <text x={curtain.x} y={-curtain.y - 160} textAnchor="middle" fontSize="140"
          fill={chosen ? '#986122' : '#1a1a1a'} pointerEvents="none">{caption}</text>}
      </g>;
    })}
    {drawing && <g data-testid="curtain-drawing" pointerEvents="none">
      <line x1={drawing.start.x} y1={-drawing.start.y} x2={(drawing.end ?? drawing.start).x} y2={-(drawing.end ?? drawing.start).y}
        stroke="#1a1a1a" strokeWidth="2.5" strokeDasharray="50 40" vectorEffect="non-scaling-stroke" />
      <circle cx={drawing.start.x} cy={-drawing.start.y} r="50" fill="#1a1a1a" />
    </g>}
  </g>;
}

export function VenueOverhead({ venue, ceilingHeight, boxes, readOnly, onCeilingHeight, onBoxes }: {
  venue: VenueGeometry; ceilingHeight: number | ''; boxes: OverheadBox[]; readOnly: boolean;
  onCeilingHeight: (value: number | '') => void;
  onBoxes: (boxes: OverheadBox[] | ((current: OverheadBox[]) => OverheadBox[])) => void;
}) {
  return <div className="venue-overhead">
    <h4>Decke und Überbauungen</h4>
    <p className="muted">Lüftung und andere Höhenhindernisse. Traversen für Licht sind ein eigenes Werkzeug.</p>
    <div><label htmlFor="venue-ceiling">Deckenhöhe über Fußboden (mm)</label>
      <input id="venue-ceiling" type="number" min={1} step="any" value={ceilingHeight}
        placeholder={`${EXAMPLE_CEILING_HEIGHT}`}
        onChange={event => onCeilingHeight(event.target.value === '' ? '' : Number(event.target.value))} /></div>
    {boxes.map((box, index) => <div className="opening-fields" key={box.id}>
      <p>{index + 1}. Überbauung</p>
      <div><label htmlFor={`overhead-label-${box.id}`}>Überbauung {index + 1} Bezeichnung</label>
        <input id={`overhead-label-${box.id}`} maxLength={120} value={box.label}
          onChange={event => onBoxes(current => current.map(item => item.id === box.id ? { ...item, label: event.target.value } : item))} /></div>
      {([['x', 'X (mm)'], ['y', 'Y (mm)'], ['rotation', 'Drehung (°)'], ['length', 'Länge (mm)'], ['width', 'Breite (mm)'],
        ['bottomHeight', 'Unterkante über Fußboden (mm)'], ['thickness', 'Dicke (mm)']] as const).map(([key, label]) =>
        <div key={key}><label htmlFor={`overhead-${key}-${box.id}`}>Überbauung {index + 1} {label}</label>
          <input id={`overhead-${key}-${box.id}`} type="number" step="any" value={box[key]}
            onChange={event => onBoxes(current => current.map(item => item.id === box.id ? { ...item, [key]: Number(event.target.value) } : item))} /></div>)}
      <button type="button" className="quiet" onClick={() => onBoxes(current => current.filter(item => item.id !== box.id))}>Überbauung entfernen</button>
    </div>)}
    {!readOnly && <div className="form-actions">
      <button type="button" className="quiet" disabled={boxes.length >= 250}
        onClick={() => onBoxes(current => [...current, newOverheadBox(crypto.randomUUID(), Math.round(venue.width / 2), Math.round(venue.depth / 2))])}>
        Überbauung hinzufügen</button>
    </div>}
  </div>;
}
