import { AUDIENCE_FLOOR_ID, newPlatform, newStair, type Platform, type StairUnit } from '../../shared/levels.js';
import type { VenueGeometry } from '../../shared/layout.js';

export function VenueLevels({ venue, platforms, stairs, readOnly, onPlatforms, onStairs }: {
  venue: VenueGeometry; platforms: Platform[]; stairs: StairUnit[]; readOnly: boolean;
  onPlatforms: (platforms: Platform[]) => void; onStairs: (stairs: StairUnit[]) => void;
}) {
  const raised = platforms[0];
  return <div className="venue-levels">
    <h4>Permanente Podeste und Treppen</h4>
    <p className="muted">Beispielmaße, keine gemessene Spielstättenvorgabe. Podeste gehören zur Spielstätte, nicht zur Szene.</p>
    {platforms.map((platform, index) => <div className="numeric-fields" key={platform.id}>
      <div><label htmlFor={`perm-platform-label-${index}`}>Podest {index + 1}</label>
        <input id={`perm-platform-label-${index}`} value={platform.label} disabled={readOnly}
          onChange={event => onPlatforms(platforms.map(item => item.id === platform.id ? { ...item, label: event.target.value } : item))} /></div>
      <div><label htmlFor={`perm-platform-elev-${index}`}>Höhe über Fußboden (mm)</label>
        <input id={`perm-platform-elev-${index}`} type="number" min={1} step="any" value={platform.elevation} disabled={readOnly}
          onChange={event => onPlatforms(platforms.map(item => item.id === platform.id ? { ...item, elevation: Number(event.target.value) } : item))} /></div>
    </div>)}
    {stairs.map((stair, index) => <div className="numeric-fields" key={stair.id}>
      <div><label htmlFor={`perm-stair-label-${index}`}>Treppe {index + 1}</label>
        <input id={`perm-stair-label-${index}`} value={stair.label} disabled={readOnly}
          onChange={event => onStairs(stairs.map(item => item.id === stair.id ? { ...item, label: event.target.value } : item))} /></div>
      <div><label htmlFor={`perm-stair-run-${index}`}>Lauflänge (mm)</label>
        <input id={`perm-stair-run-${index}`} type="number" min={1} step="any" value={stair.run} disabled={readOnly}
          onChange={event => onStairs(stairs.map(item => item.id === stair.id ? { ...item, run: Number(event.target.value) } : item))} /></div>
    </div>)}
    {!readOnly && <div className="form-actions">
      <button type="button" className="quiet" onClick={() => onPlatforms([...platforms, newPlatform(crypto.randomUUID(), venue.width / 2, venue.depth * 0.75)])}>Permanentes Podest hinzufügen</button>
      <button type="button" className="quiet" disabled={!raised}
        onClick={() => raised && onStairs([...stairs, newStair(crypto.randomUUID(), AUDIENCE_FLOOR_ID, raised.id, venue.width / 2, venue.depth / 2)])}>Permanente Treppe hinzufügen</button>
      {platforms.length > 0 && <button type="button" className="quiet" onClick={() => onPlatforms(platforms.slice(0, -1))}>Letztes Podest entfernen</button>}
      {stairs.length > 0 && <button type="button" className="quiet" onClick={() => onStairs(stairs.slice(0, -1))}>Letzte Treppe entfernen</button>}
    </div>}
  </div>;
}
