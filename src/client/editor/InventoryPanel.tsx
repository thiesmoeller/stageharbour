import { useEffect, useState, type FormEvent } from 'react';
import {
  GROUP_DOOR_STOCK_NAME, GROUP_WALL_TYPE_KINDS, GROUP_WALL_TYPE_NAMES, REPORTED_PANEL_COUNTS, groupWallType, groupWallTypeSizeLabel,
  finishWorkListSchema, type FinishWork, inventoryPanelSchema, inventorySchema, inventoryWarnings,
  placementType, typesCompatible, type GroupWallTypeKind, type InventoryPanel,
} from '../../shared/inventory.js';
import { useEditingLease } from './useEditingLease.js';
import type { Layout, Wall } from '../../shared/layout.js';
import { typesOf, type WallElementType } from '../../shared/wall-types.js';
import { PhysicalPanelForm } from './PhysicalPanelForm.js';
import { WallTypePreview, finishLabel } from './WallTypePreview.js';
import { askConfirm } from '../ConfirmDialog.js';
import { ApiError, request } from '../api.js';

/** Stock CRUD for the Bestand Plattenbestand tab. */
export function InventoryStock({ workspaceId, layout, readOnly, onPanels }: {
  workspaceId: string; layout: Layout; readOnly: boolean;
  onPanels: (panels: InventoryPanel[]) => void;
}) {
  const [panels, setPanels] = useState<InventoryPanel[]>([]);
  const [types, setTypes] = useState<WallElementType[]>([]);
  const [work, setWork] = useState<FinishWork[]>([]);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${workspaceId}/inventory`;
  const lease = useEditingLease(base, !readOnly);
  const holding = lease.holding;
  function applyInventory(data: { panels: InventoryPanel[]; types: WallElementType[] }) {
    setPanels(data.panels);
    setTypes(data.types);
    onPanels(data.panels);
  }
  async function load() {
    const data = inventorySchema.parse(await request(base));
    applyInventory(data);
    setWork(finishWorkListSchema.parse(await request(`${base}/finish-work`)));
    return data;
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = inventorySchema.parse(await request(base));
        if (cancelled) return;
        applyInventory(data);
        const pending = finishWorkListSchema.parse(await request(`${base}/finish-work`));
        if (!cancelled) setWork(pending);
      } catch {
        if (!cancelled) setError('Plattenbestand konnte nicht geladen werden.');
      }
    })();
    return () => { cancelled = true; };
  }, [base]);
  async function acquire() {
    setBusy(true); setError('');
    try { if (await lease.acquire()) await load(); }
    catch (caught) { setError(caught instanceof ApiError && caught.status === 423 ? 'Der Plattenbestand wird bereits bearbeitet.' : 'Plattenbestand konnte nicht gesperrt werden.'); }
    finally { setBusy(false); }
  }
  function resolveType(kind: string): WallElementType {
    const fromCatalogue = types.find(type => type.id === kind);
    if (fromCatalogue) return fromCatalogue;
    const fromPanel = panels.find(panel => panel.typeId === kind)?.type;
    if (fromPanel) return fromPanel;
    return groupWallType(
      (GROUP_WALL_TYPE_KINDS as readonly string[]).includes(kind) ? kind as GroupWallTypeKind : 'plain',
      crypto.randomUUID(),
      crypto.randomUUID(),
    );
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const type = resolveType(String(data.get('kind')));
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
  async function savePanel(body: Parameters<Parameters<typeof PhysicalPanelForm>[0]['onSave']>[0], panel: InventoryPanel) {
    setBusy(true); setError('');
    try {
      const updated = inventoryPanelSchema.parse(await request(`${base}/panels/${panel.id}`, body, 'PATCH'));
      setPanels(current => {
        const next = current.map(item => item.id === updated.id ? updated : item);
        onPanels(next);
        return next;
      });
      setEditingId(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409
        ? caught.message
        : caught instanceof ApiError ? caught.message : 'Platte konnte nicht gespeichert werden.');
    } finally { setBusy(false); }
  }
  async function removePanel(panel: InventoryPanel) {
    if (!await askConfirm({ title: 'Platte löschen?', message: `„${panel.label}“ aus dem Bestand löschen? Die Platte darf keinem Bühnenbild mehr zugewiesen sein.`, confirmLabel: 'Platte löschen', danger: true })) return;
    setBusy(true); setError('');
    try { await request(`${base}/panels/${panel.id}`, undefined, 'DELETE'); await load(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Platte konnte nicht gelöscht werden.'); }
    finally { setBusy(false); }
  }
  async function completeFinish(item: FinishWork, panel: InventoryPanel) {
    if (!await askConfirm({ title: 'Oberfläche fertiggestellt?', message: `Den bei der Zuweisung gespeicherten Entwurf für ${panel.label} als tatsächlich ausgeführte Oberfläche übernehmen? Der bisherige Bestandszustand wird ersetzt.`, confirmLabel: 'Arbeit abgeschlossen' })) return;
    setBusy(true); setError('');
    try {
      await request(`${base}/panels/${panel.id}/finish-complete`, { sceneId: item.sceneId, wallId: item.wallId, assignmentId: item.assignment.id });
      await load();
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Oberfläche konnte nicht bestätigt werden.'); }
    finally { setBusy(false); }
  }
  const warnings = inventoryWarnings(layout, panels);
  const catalogueOptions = types.filter(type => !GROUP_WALL_TYPE_KINDS.includes(type.id as GroupWallTypeKind));
  return <div className="inventory-panel">
    <h3>Plattenbestand</h3>
    <p className="muted">Gemeldeter Plattenbestand: {REPORTED_PANEL_COUNTS.plain} {GROUP_WALL_TYPE_NAMES.plain}, {REPORTED_PANEL_COUNTS.door} {GROUP_DOOR_STOCK_NAME}, {REPORTED_PANEL_COUNTS.window} {GROUP_WALL_TYPE_NAMES.window}, {REPORTED_PANEL_COUNTS.arch} {GROUP_WALL_TYPE_NAMES.arch} ({REPORTED_PANEL_COUNTS.plain + REPORTED_PANEL_COUNTS.door + REPORTED_PANEL_COUNTS.window + REPORTED_PANEL_COUNTS.arch} Platten), zuzüglich Halbe Wände 600×2400×250 mm. Erfassen Sie hier die tatsächlichen Plattenetiketten. Der Bogen hat gerade Laibungen und einen Halbkreis oben.</p>
    {warnings.length > 0 && <ul data-testid="inventory-warnings" role="status">{warnings.map((warning, index) => <li key={`${warning.kind}-${warning.wallId ?? index}`} data-kind={warning.kind}>{warning.message}</li>)}</ul>}
    {error && <p role="alert" className="error">{error}</p>}
    {lease.message && <p role="status">{lease.message}</p>}
    {!readOnly && !holding && <div className="form-actions"><button type="button" onClick={() => void acquire()} disabled={busy}>Plattenbestand bearbeiten</button></div>}
    <p className="muted">Verfügbar: {panels.filter(panel => panel.available).length} von {panels.length} Platten.</p>
    <label htmlFor="stock-search">Platten suchen</label><input id="stock-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Etikett, Wandtyp, Reparatur oder Tapete" />
    {!panels.length && <p className="muted">Noch keine Platten erfasst. Beginnen Sie mit dem Etikett einer echten Platte.</p>}
    <ul className="inventory-list stock-cards">{panels.filter(panel => `${panel.label} ${panel.type.name} ${panel.note ?? ''} ${panel.currentFinish?.description ?? ''}`.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de'))).map(panel => <li key={panel.id}>
      {editingId === panel.id ? <PhysicalPanelForm panel={panel} disabled={busy || !holding} onSave={body => void savePanel(body, panel)} onCancel={() => setEditingId(undefined)} /> : <>
        <div className="panel-faces"><WallTypePreview type={panel.type} cutouts={panel.cutouts} surfaces={panel.currentFinish?.surfaces} label={`${panel.label} Vorderseite`} /><WallTypePreview type={panel.type} cutouts={panel.cutouts} surfaces={panel.currentFinish?.surfaces} label={`${panel.label} Rückseite`} side="back" /><span>Vorderseite</span><span>Rückseite</span></div>
        <strong>{panel.label} · {panel.type.name}</strong>
        <span className="muted">{panel.type.width} × {panel.type.height} × {panel.type.thickness} mm · {panel.cutouts?.length ?? 0} Technikausschnitte</span>
        <label><input type="checkbox" checked={panel.available} disabled={!holding || busy} onChange={event => void setAvailable(panel, event.target.checked)} /> Verfügbar</label>
        {panel.note && <p>{panel.note}</p>}
        <p>{panel.currentFinish ? `Vorderseite: ${finishLabel(panel.currentFinish.surfaces.front?.full ?? panel.currentFinish.surfaces.front?.lower)} · Rückseite: ${finishLabel(panel.currentFinish.surfaces.back?.full ?? panel.currentFinish.surfaces.back?.lower)}` : 'Oberfläche noch nicht erfasst'}</p>
        {panel.currentFinish?.description && <p>{panel.currentFinish.description}</p>}
        {holding && <button type="button" className="quiet" disabled={busy} data-testid={`edit-panel-button-${panel.id}`} onClick={() => setEditingId(panel.id)}>Bearbeiten</button>}
        {holding && <button type="button" className="quiet" disabled={busy} onClick={() => void removePanel(panel)}>Platte löschen</button>}
        {work.filter(item => item.panelId === panel.id).map(item => <details key={`${item.sceneId}-${item.wallId}`} className="finish-work">
          <summary>{panel.currentFinish?.assignmentId === item.assignment.id ? 'Ausgeführt' : 'Geplante Oberfläche'} · {item.sceneName} · {item.wallLabel}</summary>
          <p className="muted">Entwurf zum Zeitpunkt der Plattenzuweisung. Spätere Bühnenbildänderungen verändern diesen Auftrag nicht.</p>
          <div className="panel-faces"><WallTypePreview type={panel.type} cutouts={panel.cutouts} surfaces={item.assignment.surfaces} label="Geplante Vorderseite" /><WallTypePreview type={panel.type} cutouts={panel.cutouts} surfaces={item.assignment.surfaces} label="Geplante Rückseite" side="back" /><span>Vorderseite</span><span>Rückseite</span></div>
          <button type="button" disabled={!holding || busy || panel.currentFinish?.assignmentId === item.assignment.id} onClick={() => void completeFinish(item, panel)}>Arbeit abgeschlossen</button>
        </details>)}
      </>}
    </li>)}</ul>
    {holding && <form onSubmit={event => void create(event)}><fieldset disabled={busy}>
      <label htmlFor="panel-label">Plattenetikett</label>
      <input id="panel-label" name="label" maxLength={120} required placeholder="Beispiel-P01" />
      <label htmlFor="panel-kind">Wandtyp</label>
      <select id="panel-kind" name="kind" defaultValue="plain">
        {GROUP_WALL_TYPE_KINDS.map(kind => <option key={kind} value={kind}>{GROUP_WALL_TYPE_NAMES[kind]} ({groupWallTypeSizeLabel(kind)})</option>)}
        {catalogueOptions.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
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
      {assignable.map(panel => <option key={panel.id} value={panel.id} disabled={panel.id !== selectedWall.panelId && (!panel.available || layout.walls.some(wall => wall.id !== selectedWall.id && wall.panelId === panel.id))}>{panel.label}{panel.available ? '' : ' (nicht verfügbar)'}</option>)}
      {assigned && !assignable.some(panel => panel.id === assigned.id) && <option value={assigned.id}>{assigned.label} (nicht verfügbar)</option>}
    </select>
    {assigned && <p className="muted">Zugewiesen: {assigned.label}. Der Oberflächenentwurf ist als Auftrag im Bestand festgehalten. Erst „Arbeit abgeschlossen“ ändert dort den tatsächlichen Zustand. Für einen neuen Auftrag die Zuweisung lösen, speichern und erneut zuweisen.</p>}
  </div>;
}
