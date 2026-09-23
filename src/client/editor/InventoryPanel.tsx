import { useEffect, useState, type FormEvent } from 'react';
import {
  GROUP_DOOR_STOCK_NAME, GROUP_WALL_TYPE_KINDS, GROUP_WALL_TYPE_NAMES, REPORTED_PANEL_COUNTS, groupWallType, groupWallTypeSizeLabel,
  inventoryPanelSchema, inventorySchema, inventoryWarnings,
  placementType, typesCompatible, type GroupWallTypeKind, type InventoryPanel,
} from '../../shared/inventory.js';
import { useEditingLease } from './useEditingLease.js';
import type { Layout, Wall } from '../../shared/layout.js';
import { typesOf } from '../../shared/wall-types.js';
import { ApiError, request } from '../api.js';

/** Stock CRUD for the Bibliothek Plattenbestand tab. */
export function InventoryStock({ workspaceId, layout, readOnly, onPanels }: {
  workspaceId: string; layout: Layout; readOnly: boolean;
  onPanels: (panels: InventoryPanel[]) => void;
}) {
  const [panels, setPanels] = useState<InventoryPanel[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${workspaceId}/inventory`;
  const lease = useEditingLease(base, !readOnly);
  const holding = lease.holding;
  async function load() {
    const data = inventorySchema.parse(await request(base));
    setPanels(data.panels);
    onPanels(data.panels);
    return data;
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = inventorySchema.parse(await request(base));
        if (cancelled) return;
        setPanels(data.panels);
        onPanels(data.panels);
      } catch {
        if (!cancelled) setError('Bestand konnte nicht geladen werden.');
      }
    })();
    return () => { cancelled = true; };
  }, [base]);
  async function acquire() {
    setBusy(true); setError('');
    try { if (await lease.acquire()) await load(); }
    catch (caught) { setError(caught instanceof ApiError && caught.status === 423 ? 'Der Bestand wird bereits bearbeitet.' : 'Bestand konnte nicht gesperrt werden.'); }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get('kind'));
    const existing = panels.find(panel => panel.typeId === kind)?.type;
    const type = existing ?? groupWallType(
      (GROUP_WALL_TYPE_KINDS as readonly string[]).includes(kind) ? kind as GroupWallTypeKind : 'plain',
      crypto.randomUUID(),
      crypto.randomUUID(),
    );
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
      setPanels(current => {
        const next = current.map(item => item.id === updated.id ? updated : item);
        onPanels(next);
        return next;
      });
    } catch { setError('Verfügbarkeit konnte nicht geändert werden.'); }
    finally { setBusy(false); }
  }
  const warnings = inventoryWarnings(layout, panels);
  return <div className="inventory-panel">
    <h3>Plattenbestand</h3>
    <p className="muted">Gemeldeter Bestand: {REPORTED_PANEL_COUNTS.plain} {GROUP_WALL_TYPE_NAMES.plain}, {REPORTED_PANEL_COUNTS.door} {GROUP_DOOR_STOCK_NAME}, {REPORTED_PANEL_COUNTS.window} {GROUP_WALL_TYPE_NAMES.window}, {REPORTED_PANEL_COUNTS.arch} {GROUP_WALL_TYPE_NAMES.arch} ({REPORTED_PANEL_COUNTS.plain + REPORTED_PANEL_COUNTS.door + REPORTED_PANEL_COUNTS.window + REPORTED_PANEL_COUNTS.arch} Platten), zuzüglich Halbe Wände 600×2400×250 mm. Etiketten hier sind Beispiele. Das Bogenprofil bleibt vorerst rechteckig.</p>
    {warnings.length > 0 && <ul data-testid="inventory-warnings" role="status">{warnings.map((warning, index) => <li key={`${warning.kind}-${warning.wallId ?? index}`} data-kind={warning.kind}>{warning.message}</li>)}</ul>}
    {error && <p role="alert" className="error">{error}</p>}
    {lease.message && <p role="status">{lease.message}</p>}
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
        {GROUP_WALL_TYPE_KINDS.map(kind => <option key={kind} value={kind}>{GROUP_WALL_TYPE_NAMES[kind]} ({groupWallTypeSizeLabel(kind)})</option>)}
        {[...new Map(panels.map(panel => [panel.typeId, panel.type])).values()].map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
      </select>
      <label htmlFor="panel-available"><input id="panel-available" name="available" type="checkbox" defaultChecked /> Verfügbar</label>
      <label htmlFor="panel-note">Reparaturhinweis</label>
      <input id="panel-note" name="note" maxLength={500} />
      <div className="form-actions"><button type="submit">Platte anlegen</button></div>
    </fieldset></form>}
  </div>;
}

/** Assignment UI for a selected wall — panels come from Editor (updated by InventoryStock). */
export function InventoryAssignment({ layout, selectedWall, panels, readOnly, onAssign, onUnassign }: {
  layout: Layout; selectedWall: Wall; panels: InventoryPanel[]; readOnly: boolean;
  onAssign: (panelId: string) => void; onUnassign: () => void;
}) {
  const warnings = inventoryWarnings(layout, panels);
  const placement = placementType(selectedWall, typesOf(layout));
  const assignable = panels.filter(panel => panel.id === selectedWall.panelId || typesCompatible(panel.type, placement));
  const assigned = panels.find(panel => panel.id === selectedWall.panelId);
  return <div className="inventory-assignment" data-testid="inventory-assignment" data-panel-count={panels.length}>
    <h4>Plattenzuweisung</h4>
    {warnings.length > 0 && <ul data-testid="inventory-warnings" role="status">{warnings.map((warning, index) => <li key={`${warning.kind}-${warning.wallId ?? index}`} data-kind={warning.kind}>{warning.message}</li>)}</ul>}
    <label htmlFor="panel-assignment">Platte zuweisen</label>
    <select id="panel-assignment" value={selectedWall.panelId ?? ''} disabled={readOnly} onChange={event => event.target.value ? onAssign(event.target.value) : onUnassign()}>
      <option value="">Keine Platte</option>
      {assignable.map(panel => <option key={panel.id} value={panel.id}>{panel.label}{panel.available ? '' : ' (nicht verfügbar)'}</option>)}
      {assigned && !assignable.some(panel => panel.id === assigned.id) && <option value={assigned.id}>{assigned.label} (nicht verfügbar)</option>}
    </select>
    {assigned && <p className="muted">Zugewiesen: {assigned.label}</p>}
  </div>;
}
