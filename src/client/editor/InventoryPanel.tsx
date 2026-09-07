import { useEffect, useState, type FormEvent } from 'react';
import {
  EXAMPLE_DOOR_OPENING, EXAMPLE_PLAIN, EXAMPLE_WINDOW_OPENING, REPORTED_PANEL_COUNTS, inventoryPanelSchema, inventorySchema, inventoryWarnings,
  placementType, typesCompatible, type InventoryPanel,
} from '../../shared/inventory.js';
import { LEASE_HEARTBEAT_MS } from '../../shared/leases.js';
import type { Layout, Wall } from '../../shared/layout.js';
import { newWallType, typesOf } from '../../shared/wall-types.js';
import { ApiError, request } from '../api.js';

export function InventoryPanel({ workspaceId, layout, selectedWall, readOnly, onAssign, onUnassign }: {
  workspaceId: string; layout: Layout; selectedWall?: Wall; readOnly: boolean;
  onAssign: (panelId: string) => void; onUnassign: () => void;
}) {
  const [panels, setPanels] = useState<InventoryPanel[]>([]);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${workspaceId}/inventory`;
  async function load() {
    const data = inventorySchema.parse(await request(base));
    setPanels(data.panels);
    return data;
  }
  useEffect(() => {
    let cancelled = false;
    load().catch(() => { if (!cancelled) setError('Bestand konnte nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [base]);
  useEffect(() => {
    if (!holding) return;
    const tick = window.setInterval(() => {
      request(`${base}/lease/heartbeat`, {}).catch(caught => {
        if (caught instanceof ApiError && caught.status === 423) setHolding(false);
      });
    }, LEASE_HEARTBEAT_MS);
    return () => clearInterval(tick);
  }, [holding, base]);
  useEffect(() => () => { if (holding) void request(`${base}/lease/release`, {}).catch(() => {}); }, [holding, base]);
  async function acquire() {
    setBusy(true); setError('');
    try { await request(`${base}/lease`, {}); setHolding(true); await load(); }
    catch (caught) { setError(caught instanceof ApiError && caught.status === 423 ? 'Der Bestand wird bereits bearbeitet.' : 'Bestand konnte nicht gesperrt werden.'); }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get('kind'));
    const existing = panels.find(panel => panel.typeId === kind)?.type;
    const type = existing ?? (kind === 'door'
      ? { ...newWallType(crypto.randomUUID()), name: 'Beispiel-Türwand', width: 1200, height: 2400, thickness: 28, openings: [{ id: crypto.randomUUID(), ...EXAMPLE_DOOR_OPENING }] }
      : kind === 'window'
        ? { ...newWallType(crypto.randomUUID()), name: 'Beispiel-Fensterwand', width: 1200, height: 2400, thickness: 28, openings: [{ id: crypto.randomUUID(), ...EXAMPLE_WINDOW_OPENING }] }
        : { ...newWallType(crypto.randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' });
    setBusy(true); setError('');
    try {
      await request(`${base}/panels`, { label: data.get('label'), type, available: data.get('available') === 'on', note: String(data.get('note') ?? '').trim() || null });
      await load();
      form.reset();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? 'Dieses Plattenetikett ist bereits vergeben.' : 'Platte konnte nicht angelegt werden.');
    } finally { setBusy(false); }
  }
  async function setAvailable(panel: InventoryPanel, available: boolean) {
    setBusy(true); setError('');
    try {
      const updated = inventoryPanelSchema.parse(await request(`${base}/panels/${panel.id}`, { available }, 'PATCH'));
      setPanels(current => current.map(item => item.id === updated.id ? updated : item));
    } catch { setError('Verfügbarkeit konnte nicht geändert werden.'); }
    finally { setBusy(false); }
  }
  const warnings = inventoryWarnings(layout, panels);
  const placement = selectedWall ? placementType(selectedWall, typesOf(layout)) : undefined;
  const assignable = selectedWall && placement
    ? panels.filter(panel => panel.id === selectedWall.panelId || typesCompatible(panel.type, placement))
    : [];
  const assigned = panels.find(panel => panel.id === selectedWall?.panelId);
  return <div className="inventory-panel">
    <h3>Bestand</h3>
    <p className="muted">Gemeldeter Bestand: {REPORTED_PANEL_COUNTS.plain} glatt, {REPORTED_PANEL_COUNTS.door} Tür, {REPORTED_PANEL_COUNTS.window} Fenster, {REPORTED_PANEL_COUNTS.arch} Bogen ({REPORTED_PANEL_COUNTS.plain + REPORTED_PANEL_COUNTS.door + REPORTED_PANEL_COUNTS.window + REPORTED_PANEL_COUNTS.arch} Platten). Etiketten hier sind Beispiele, keine echten Kennzeichnungen. Das Bogenprofil wird nicht vorgegeben.</p>
    {warnings.length > 0 && <ul data-testid="inventory-warnings" role="status">{warnings.map((warning, index) => <li key={`${warning.kind}-${warning.wallId ?? index}`} data-kind={warning.kind}>{warning.message}</li>)}</ul>}
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && !holding && <div className="form-actions"><button type="button" onClick={() => void acquire()} disabled={busy}>Bestand bearbeiten</button></div>}
    <p className="muted">Verfügbar: {panels.filter(panel => panel.available).length} von {panels.length} Platten.</p>
    {panels.length > 0 && <ul className="inventory-list">{panels.map(panel => <li key={panel.id}>
      <label><input type="checkbox" checked={panel.available} disabled={!holding || busy} onChange={event => void setAvailable(panel, event.target.checked)} /> {panel.label} · {panel.type.name}{panel.note ? ` · ${panel.note}` : ''}</label>
    </li>)}</ul>}
    {holding && <form onSubmit={event => void create(event)}><fieldset disabled={busy}>
      <label htmlFor="panel-label">Plattenetikett</label>
      <input id="panel-label" name="label" maxLength={120} required placeholder="Beispiel-P01" />
      <label htmlFor="panel-kind">Wandtyp</label>
      <select id="panel-kind" name="kind" defaultValue="plain">
        <option value="plain">Beispiel-Glattwand (1200×2400×28 mm)</option>
        <option value="door">Beispiel-Türwand (rechteckige Öffnung)</option>
        <option value="window">Beispiel-Fensterwand (rechteckige Öffnung)</option>
        {[...new Map(panels.map(panel => [panel.typeId, panel.type])).values()].map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
      </select>
      <label htmlFor="panel-available"><input id="panel-available" name="available" type="checkbox" defaultChecked /> Verfügbar</label>
      <label htmlFor="panel-note">Reparaturhinweis</label>
      <input id="panel-note" name="note" maxLength={500} />
      <div className="form-actions"><button type="submit">Platte anlegen</button></div>
    </fieldset></form>}
    <h4>Zuweisung</h4>
    {selectedWall ? <>
      <label htmlFor="panel-assignment">Platte zuweisen</label>
      <select id="panel-assignment" value={selectedWall.panelId ?? ''} disabled={readOnly} onChange={event => event.target.value ? onAssign(event.target.value) : onUnassign()}>
        <option value="">Keine Platte</option>
        {assignable.map(panel => <option key={panel.id} value={panel.id}>{panel.label}{panel.available ? '' : ' (nicht verfügbar)'}</option>)}
        {assigned && !assignable.some(panel => panel.id === assigned.id) && <option value={assigned.id}>{assigned.label} (nicht verfügbar)</option>}
      </select>
      {assigned && <p className="muted">Zugewiesen: {assigned.label}</p>}
    </> : <p className="muted">Wählen Sie ein Wandelement, um eine Platte zuzuweisen.</p>}
  </div>;
}
