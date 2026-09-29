import { supportingSurfaces } from '../../shared/levels.js';
import { type KeepClearZone } from '../../shared/keepClear.js';
import { OUTLINE_VERTEX_INSERT_MM, type PlanPoint } from '../../shared/venue.js';
import type { VenueGeometry } from '../../shared/layout.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';
import type { PointerEvent } from 'react';

export function KeepClearMarks({ zones, selectedIds = [], drawing, display = defaultPlanDisplay, onPointerDown, onVertexPointerDown }: {
  zones: KeepClearZone[]; selectedIds?: readonly string[];
  drawing?: PlanPoint[];
  display?: PlanDisplayOptions;
  onPointerDown?: (event: PointerEvent<SVGGElement>, id: string) => void;
  onVertexPointerDown?: (event: PointerEvent<SVGCircleElement>, zoneId: string, index: number) => void;
}) {
  return <g aria-label="Freihaltezonen" pointerEvents={onPointerDown || onVertexPointerDown ? undefined : 'none'}>
    {zones.map(zone => {
      const cx = zone.polygon.reduce((sum, point) => sum + point.x, 0) / zone.polygon.length;
      const cy = zone.polygon.reduce((sum, point) => sum + point.y, 0) / zone.polygon.length;
      const chosen = selectedIds.includes(zone.id);
      return <g key={zone.id} data-print-layer="constraints" data-print-name={zone.label} data-testid={`keep-clear-zone-${zone.id}`} className={onPointerDown ? 'draggable-wall' : undefined}
        onPointerDown={onPointerDown ? event => onPointerDown(event, zone.id) : undefined}>
        <path d={`${zone.polygon.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill={chosen ? '#b67c3555' : '#b67c3522'} stroke="#b67c35" strokeWidth="2" strokeDasharray="80 50" vectorEffect="non-scaling-stroke" />
        {zone.polygon.map((point, index) => <circle key={index} data-testid={`keep-clear-vertex-${zone.id}-${index}`}
          cx={point.x} cy={-point.y} r="65" fill="#b67c35"
          pointerEvents={onVertexPointerDown ? undefined : 'none'}
          onPointerDown={onVertexPointerDown ? event => onVertexPointerDown(event, zone.id, index) : undefined} />)}
        {display.showObjectNames && <text x={cx} y={-cy} textAnchor="middle" fontSize="140" pointerEvents="none">{zone.label}</text>}
      </g>;
    })}
    {drawing && drawing.length > 0 && <g data-testid="keep-clear-drawing" pointerEvents="none">
      <path d={drawing.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')}
        fill="none" stroke="#b67c35" strokeWidth="3" strokeDasharray="40 40" vectorEffect="non-scaling-stroke" />
      {drawing.map((point, index) => <circle key={index} cx={point.x} cy={-point.y} r="50" fill="#b67c35" />)}
      {drawing.length >= 3 && <circle cx={drawing[0]!.x} cy={-drawing[0]!.y} r={OUTLINE_VERTEX_INSERT_MM}
        fill="none" stroke="#b67c35" strokeWidth="2" strokeDasharray="20 20" vectorEffect="non-scaling-stroke" />}
    </g>}
  </g>;
}

export function KeepClearZones({ venue, zones, click, readOnly, onClick, onZones }: {
  venue: VenueGeometry; zones: KeepClearZone[]; click: string; readOnly: boolean;
  onClick: (value: 'draw-zone' | 'zone-vertex') => void;
  onZones: (value: KeepClearZone[] | ((current: KeepClearZone[]) => KeepClearZone[])) => void;
}) {
  const surfaces = supportingSurfaces(venue);
  const centre = { x: Math.round(venue.width / 2), y: Math.round(venue.depth / 2) };
  return <div className="keep-clear">
    <h4>Freihaltezonen</h4>
    <p className="muted">Polygonflächen zeichnen (Eckpunkte setzen, nahe dem ersten Punkt schließen). Eckpunkte im Grundriss ziehen. Überlappungen werden gewarnt; Speichern bleibt möglich.</p>
    {!readOnly && <div className="form-actions">
      <button type="button" className={click === 'draw-zone' ? '' : 'quiet'} disabled={zones.length >= 250}
        onClick={() => onClick('draw-zone')}>Freihaltezone zeichnen</button>
      <button type="button" className={click === 'zone-vertex' ? '' : 'quiet'} disabled={!zones.length}
        onClick={() => onClick('zone-vertex')}>Eckpunkt auf Zonenkante setzen</button>
      {zones.length > 0 && <button type="button" className="quiet" onClick={() => onZones(current => current.slice(0, -1))}>Letzte Freihaltezone entfernen</button>}
    </div>}
    {zones.map((zone, index) => <div className="opening-fields" key={zone.id}>
      <p>{index + 1}. Freihaltezone</p>
      <div><label htmlFor={`keep-clear-label-${zone.id}`}>Freihaltezone {index + 1} Bezeichnung</label>
        <input id={`keep-clear-label-${zone.id}`} maxLength={120} value={zone.label} disabled={readOnly}
          onChange={event => onZones(current => current.map(item => item.id === zone.id ? { ...item, label: event.target.value } : item))} /></div>
      <div><label htmlFor={`keep-clear-reason-${zone.id}`}>Freihaltezone {index + 1} Grund</label>
        <input id={`keep-clear-reason-${zone.id}`} maxLength={120} value={zone.reason} disabled={readOnly}
          onChange={event => onZones(current => current.map(item => item.id === zone.id ? { ...item, reason: event.target.value } : item))} /></div>
      <div><label htmlFor={`keep-clear-surface-${zone.id}`}>Freihaltezone {index + 1} Auflagefläche</label>
        <select id={`keep-clear-surface-${zone.id}`} value={zone.supportingSurfaceId} disabled={readOnly}
          onChange={event => onZones(current => current.map(item => item.id === zone.id ? { ...item, supportingSurfaceId: event.target.value } : item))}>
          {surfaces.map(surface => <option key={surface.id} value={surface.id}>{surface.label} ({surface.elevation} mm)</option>)}
        </select></div>
      {zone.polygon.map((point, pointIndex) => [
        <div key={`x-${pointIndex}`}><label htmlFor={`keep-clear-${zone.id}-p${pointIndex}-x`}>Freihaltezone {index + 1} Zonenpunkt {pointIndex + 1} X (mm)</label>
          <input id={`keep-clear-${zone.id}-p${pointIndex}-x`} type="number" step="any" value={point.x} disabled={readOnly}
            onChange={event => onZones(current => current.map(item => item.id === zone.id ? { ...item, polygon: item.polygon.map((entry, i) => i === pointIndex ? { ...entry, x: Number(event.target.value) } : entry) } : item))} /></div>,
        <div key={`y-${pointIndex}`}><label htmlFor={`keep-clear-${zone.id}-p${pointIndex}-y`}>Freihaltezone {index + 1} Zonenpunkt {pointIndex + 1} Y (mm)</label>
          <input id={`keep-clear-${zone.id}-p${pointIndex}-y`} type="number" step="any" value={point.y} disabled={readOnly}
            onChange={event => onZones(current => current.map(item => item.id === zone.id ? { ...item, polygon: item.polygon.map((entry, i) => i === pointIndex ? { ...entry, y: Number(event.target.value) } : entry) } : item))} /></div>,
      ])}
      {!readOnly && <>
        <button type="button" className="quiet" onClick={() => onZones(current => current.map(item => item.id === zone.id ? { ...item, polygon: [...item.polygon, { x: centre.x, y: centre.y }] } : item))}>Zonenpunkt hinzufügen</button>
        <button type="button" className="quiet" disabled={zone.polygon.length <= 3} onClick={() => onZones(current => current.map(item => item.id === zone.id ? { ...item, polygon: item.polygon.slice(0, -1) } : item))}>Letzten Zonenpunkt entfernen</button>
      </>}
    </div>)}
  </div>;
}
