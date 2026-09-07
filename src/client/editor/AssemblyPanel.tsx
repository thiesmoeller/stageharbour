import { type FormEvent } from 'react';
import {
  CONNECTION_COMPATIBILITY_NOTICE, assignAssemblyNumbers, recordConnection, type PanelConnection,
} from '../../shared/assembly.js';
import type { Layout, Wall } from '../../shared/layout.js';

export function AssemblyPanel({ layout, selectedWall, readOnly, onChange }: {
  layout: Layout; selectedWall?: Wall; readOnly: boolean; onChange: (layout: Layout) => void;
}) {
  const connections = layout.connections ?? [];
  const linked = new Set(connections.flatMap(connection => {
    if (!selectedWall || (connection.a !== selectedWall.id && connection.b !== selectedWall.id)) return [];
    return [connection.a === selectedWall.id ? connection.b : connection.a];
  }));
  const others = layout.walls.filter(wall => wall.id !== selectedWall?.id && !linked.has(wall.id));
  function caption(wall?: Wall) {
    return wall?.assemblyNumber ? `Position ${wall.assemblyNumber}` : wall?.label ?? wall?.id ?? '';
  }
  function connectionLabel(connection: PanelConnection) {
    const a = layout.walls.find(wall => wall.id === connection.a);
    const b = layout.walls.find(wall => wall.id === connection.b);
    return `${caption(a)} – ${caption(b)}`;
  }
  function notes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onChange({ ...layout, riggingNotes: String(new FormData(event.currentTarget).get('riggingNotes') ?? '') });
  }
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otherId = String(new FormData(event.currentTarget).get('other') ?? '');
    if (!selectedWall || !otherId) return;
    onChange(recordConnection(layout, selectedWall.id, otherId));
  }
  return <div className="assembly-panel">
    <h3>Montage</h3>
    <p className="muted">Montagenummern werden von links nach rechts aus Publikumsicht vergeben und bleiben danach gespeichert. Sie sind keine Plattenetiketten.</p>
    {selectedWall?.assemblyNumber
      ? <p>Montagenummer: Position {selectedWall.assemblyNumber}</p>
      : <p className="muted">{selectedWall ? 'Diese Wand hat noch keine Montagenummer.' : 'Wählen Sie eine Wand, um Verbindungen zu erfassen.'}</p>}
    {!readOnly && <div className="form-actions">
      <button type="button" disabled={!layout.walls.some(wall => wall.assemblyNumber == null)}
        onClick={() => onChange({ ...layout, walls: assignAssemblyNumbers(layout.walls) })}>Montagenummern vergeben</button>
    </div>}
    {selectedWall && others.length > 0 && <form onSubmit={connect}><fieldset disabled={readOnly}>
      <label htmlFor="assembly-other">Verbinden mit</label>
      <select id="assembly-other" name="other" defaultValue={others[0]?.id}>
        {others.map(wall => <option key={wall.id} value={wall.id}>{caption(wall)}</option>)}
      </select>
      <div className="form-actions"><button type="submit">Verbindung eintragen</button></div>
    </fieldset></form>}
    {connections.length > 0 && <ul data-testid="assembly-connections">{connections.map(connection => <li key={connection.id}>
      {connectionLabel(connection)}
      {!readOnly && <button className="quiet" type="button" onClick={() => onChange({
        ...layout, connections: connections.filter(item => item.id !== connection.id),
      })}>Lösen</button>}
    </li>)}</ul>}
    <form key={layout.riggingNotes ?? ''} onSubmit={notes}><fieldset disabled={readOnly}>
      <label htmlFor="rigging-notes">Rigginghinweise</label>
      <textarea id="rigging-notes" name="riggingNotes" maxLength={2000} defaultValue={layout.riggingNotes ?? ''} rows={3} />
      {!readOnly && <div className="form-actions"><button type="submit">Hinweise speichern</button></div>}
    </fieldset></form>
    <p className="muted">Stiftwechsel gehören in die Hinweise. Ein Neuverschrauben der Scharniere ist eine eigene Riggingeinrichtung. {CONNECTION_COMPATIBILITY_NOTICE}</p>
  </div>;
}
