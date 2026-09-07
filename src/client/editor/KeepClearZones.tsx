import { AUDIENCE_FLOOR_ID, supportingSurfaces } from '../../shared/levels.js';
import { newKeepClearZone, type KeepClearZone } from '../../shared/keepClear.js';
import type { VenueGeometry } from '../../shared/layout.js';

export function KeepClearMarks({ zones }: { zones: KeepClearZone[] }) {
  return <g pointerEvents="none" aria-label="Freihaltezonen">
    {zones.map(zone => {
      const cx = zone.polygon.reduce((sum, point) => sum + point.x, 0) / zone.polygon.length;
      const cy = zone.polygon.reduce((sum, point) => sum + point.y, 0) / zone.polygon.length;
      return <g key={zone.id} data-testid={`keep-clear-zone-${zone.id}`}>
        <path d={`${zone.polygon.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill="#b67c3522" stroke="#b67c35" strokeWidth="2" strokeDasharray="80 50" vectorEffect="non-scaling-stroke" />
        {zone.polygon.map((point, index) => <circle key={index} cx={point.x} cy={-point.y} r="35" fill="#b67c35" />)}
        <text x={cx} y={-cy} textAnchor="middle" fontSize="140">{zone.label}</text>
      </g>;
    })}
  </g>;
}

export function KeepClearZones({ venue, zones, click, readOnly, onClick, onZones }: {
  venue: VenueGeometry; zones: KeepClearZone[]; click: string; readOnly: boolean;
  onClick: (value: 'zone') => void;
  onZones: (value: KeepClearZone[] | ((current: KeepClearZone[]) => KeepClearZone[])) => void;
}) {
  const surfaces = supportingSurfaces(venue);
  const centre = { x: Math.round(venue.width / 2), y: Math.round(venue.depth / 2) };
  return <div className="keep-clear">
    <h4>Freihaltezonen</h4>
    <p className="muted">Beispielmaße, keine gemessene Spielstättenvorgabe. Beschriftete Flächen mit einem Grund wie Notausgang oder Zugang zur Tontechnik. Überlappungen mit Wänden, Stützen und beweglichen Teilen auf derselben Auflagefläche werden gewarnt; Speichern bleibt möglich.</p>
    {!readOnly && <div className="form-actions">
      <button type="button" className="quiet" disabled={zones.length >= 250} onClick={() => {
        onClick('zone');
        onZones(current => [...current, newKeepClearZone(crypto.randomUUID(), AUDIENCE_FLOOR_ID, centre.x, centre.y)]);
      }}>Freihaltezone hinzufügen</button>
      <button type="button" className={click === 'zone' ? '' : 'quiet'} onClick={() => onClick('zone')}>Punkt der Freihaltezone in der Zeichnung setzen</button>
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
