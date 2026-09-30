import { BallastStock } from './BallastStock.js';
import { useEffect, useState } from 'react';
import { can } from '../../shared/permissions.js';
import type { Me } from '../../shared/contracts.js';
import { inventorySchema } from '../../shared/inventory.js';
import type { WallElementType } from '../../shared/wall-types.js';
import { ApiError, request } from '../api.js';
import { InventoryStock } from './InventoryPanel.js';
import { WallTypePanel } from './WallTypePanel.js';
import { useEditingLease } from './useEditingLease.js';

const EMPTY_LAYOUT = { schemaVersion: 1 as const, walls: [], braces: [] };

type BestandTab = 'panels' | 'types' | 'ballast';

/** Workspace home for physical panels and stocked wall-element types (ADR 0005). */
export function Bestand({ me }: { me: Me }) {
  const [tab, setTab] = useState<BestandTab>('panels');
  const readOnly = !can(me.workspace.role, 'inventory');
  return <section className="plans venue-library" aria-label="Bestand" data-testid="bestand-page">
    <div className="section-heading">
      <div>
        <h2>Bestand</h2>
        <p className="muted">Platten, Wandtypen und Beschwerung des Arbeitsbereichs. Bühnenbilder zuerst entwerfen; Platten später zuweisen.</p>
      </div>
    </div>
    <div className="asset-tabs" role="tablist" aria-label="Bestand">
      <button type="button" role="tab" className="quiet" aria-selected={tab === 'panels'} aria-pressed={tab === 'panels'}
        data-testid="bestand-tab-panels" onClick={() => setTab('panels')}>Platten</button>
      <button type="button" role="tab" className="quiet" aria-selected={tab === 'types'} aria-pressed={tab === 'types'}
        data-testid="bestand-tab-types" onClick={() => setTab('types')}>Wandtypen</button>
      <button type="button" role="tab" className="quiet" aria-selected={tab === 'ballast'} aria-pressed={tab === 'ballast'}
        data-testid="bestand-tab-ballast" onClick={() => setTab('ballast')}>Beschwerung</button>
    </div>
    {tab === 'ballast' && <BallastStock workspaceId={me.workspace.id} readOnly={readOnly} />}
    {tab === 'panels' && <InventoryStock workspaceId={me.workspace.id} layout={EMPTY_LAYOUT} readOnly={readOnly}
      onPanels={() => { /* stock list is self-contained */ }} />}
    {tab === 'types' && <InventoryTypesStock workspaceId={me.workspace.id} readOnly={readOnly} />}
  </section>;
}

function InventoryTypesStock({ workspaceId, readOnly }: { workspaceId: string; readOnly: boolean }) {
  const [types, setTypes] = useState<WallElementType[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${workspaceId}/inventory`;
  const lease = useEditingLease(base, !readOnly);
  const holding = lease.holding;

  async function load() {
    const data = inventorySchema.parse(await request(base));
    setTypes(data.types);
    return data;
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = inventorySchema.parse(await request(base));
        if (!cancelled) setTypes(data.types);
      } catch {
        if (!cancelled) setError('Wandtypen konnten nicht geladen werden.');
      }
    })();
    return () => { cancelled = true; };
  }, [base]);

  async function acquire() {
    setBusy(true); setError('');
    try { if (await lease.acquire()) await load(); }
    catch (caught) {
      setError(caught instanceof ApiError && caught.status === 423
        ? 'Der Bestand wird bereits bearbeitet.'
        : 'Bestand konnte nicht gesperrt werden.');
    } finally { setBusy(false); }
  }

  async function persistCreate(type: WallElementType) {
    setBusy(true); setError('');
    try {
      await request(`${base}/types`, type);
      await load();
      setSelectedId(type.id);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409
        ? 'Dieser Wandtyp ist im Bestand bereits angelegt.'
        : 'Wandtyp konnte nicht angelegt werden.');
    } finally { setBusy(false); }
  }

  async function persistApply(type: WallElementType) {
    setBusy(true); setError('');
    try {
      await request(`${base}/types/${type.id}`, type, 'PUT');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409
        ? 'Dieser Wandtyp ist im Bestand bereits anders definiert.'
        : 'Wandtyp konnte nicht gespeichert werden.');
    } finally { setBusy(false); }
  }

  async function persistRemove(id: string) {
    setBusy(true); setError('');
    try {
      await request(`${base}/types/${id}`, undefined, 'DELETE');
      await load();
      setSelectedId(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409
        ? 'Dieser Wandtyp wird noch von Platten verwendet.'
        : 'Wandtyp konnte nicht gelöscht werden.');
    } finally { setBusy(false); }
  }

  return <div className="inventory-panel" data-testid="bestand-types">
    <p className="muted">Wandtypen für Platten (inkl. Tür/Fenster). Einmalige Typen bleiben im Bühnenbild möglich.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {lease.message && <p role="status">{lease.message}</p>}
    {!readOnly && !holding && <div className="form-actions">
      <button type="button" onClick={() => void acquire()} disabled={busy}>Wandtypen bearbeiten</button>
    </div>}
    <fieldset disabled={busy}>
      <WallTypePanel
        types={types}
        selectedId={selectedId}
        readOnly={!holding || readOnly}
        onSelect={setSelectedId}
        onCreate={type => { void persistCreate(type); }}
        onApply={type => { void persistApply(type); }}
        onRemove={id => { void persistRemove(id); }}
      />
    </fieldset>
  </div>;
}
