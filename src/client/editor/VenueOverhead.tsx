import { EXAMPLE_CEILING_HEIGHT, newOverheadBox, overheadBoxCorners, type OverheadBox } from '../../shared/overhead.js';
import type { VenueGeometry } from '../../shared/layout.js';
import type { PointerEvent } from 'react';

export function OverheadMarks({ boxes, selectedIds = [], onPointerDown }: {
  boxes: OverheadBox[]; selectedIds?: readonly string[];
  onPointerDown?: (event: PointerEvent<SVGGElement>, id: string) => void;
}) {
  return <g aria-label="Überbauungen" pointerEvents={onPointerDown ? undefined : 'none'}>
    {boxes.map(box => {
      const corners = overheadBoxCorners(box);
      const chosen = selectedIds.includes(box.id);
      return <g key={box.id} data-testid={`overhead-box-${box.id}`} className={onPointerDown ? 'draggable-wall' : undefined}
        onPointerDown={onPointerDown ? event => onPointerDown(event, box.id) : undefined}>
        <path d={`${corners.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill={chosen ? '#d9c6a166' : '#d9c6a133'} stroke="#8a6a3a" strokeWidth="2" strokeDasharray="80 50" vectorEffect="non-scaling-stroke" />
        <text x={box.x} y={-box.y} textAnchor="middle" fontSize="140" pointerEvents="none">{box.label} · {box.bottomHeight} mm</text>
      </g>;
    })}
  </g>;
}

export function VenueOverhead({ venue, ceilingHeight, boxes, readOnly, onCeilingHeight, onBoxes }: {
  venue: VenueGeometry; ceilingHeight: number | ''; boxes: OverheadBox[]; readOnly: boolean;
  onCeilingHeight: (value: number | '') => void;
  onBoxes: (boxes: OverheadBox[] | ((current: OverheadBox[]) => OverheadBox[])) => void;
}) {
  return <div className="venue-overhead">
    <h4>Decke und Überbauungen</h4>
    <p className="muted">Beispielmaße, keine gemessene Spielstättenvorgabe. Mehrere Kästen beschreiben ein komplexes Bauteil (z. B. Lüftungskanal über der Bühne). Geometrische Hinweise, kein statischer Nachweis.</p>
    <div><label htmlFor="venue-ceiling">Deckenhöhe über Fußboden (mm)</label>
      <input id="venue-ceiling" type="number" min={1} step="any" value={ceilingHeight}
        placeholder={`${EXAMPLE_CEILING_HEIGHT}`}
        onChange={event => onCeilingHeight(event.target.value === '' ? '' : Number(event.target.value))} /></div>
    {boxes.map((box, index) => <div className="opening-fields" key={box.id}>
      <p>{index + 1}. Überbauung</p>
      <div><label htmlFor={`overhead-label-${box.id}`}>Überbauung {index + 1} Bezeichnung</label>
        <input id={`overhead-label-${box.id}`} maxLength={120} value={box.label}
          onChange={event => onBoxes(current => current.map(item => item.id === box.id ? { ...item, label: event.target.value } : item))} /></div>
      {([['x', 'X (mm)'], ['y', 'Y (mm)'], ['length', 'Länge (mm)'], ['width', 'Breite (mm)'],
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
