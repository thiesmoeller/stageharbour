import { useEffect, useState, type FormEvent } from 'react';
import { can } from '../../shared/permissions.js';
import type { Me } from '../../shared/contracts.js';
import type { PartSummary, StockItem } from '../../shared/parts/catalog.js';
import {
  createStockItem, listParts, listStockItems, updateStockItem,
} from '../partsApi.js';
import { BallastStock } from './BallastStock.js';
import { StockCounts } from './StockCounts.js';

type BestandTab = 'items' | 'counts' | 'parts' | 'hardware';

/** Workspace stock is catalog based: a physical item references one stable part and optional variant. */
export function Bestand({ me }: { me: Me }) {
  const [tab, setTab] = useState<BestandTab>('items');
  const [parts, setParts] = useState<PartSummary[]>([]);
  const [items, setItems] = useState<StockItem[]>([]);
  const [createPartId, setCreatePartId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const readOnly = !can(me.workspace.role, 'inventory');
  async function load() {
    const [nextParts, nextItems] = await Promise.all([
      listParts(me.workspace.id, { includeArchived: true }),
      listStockItems(me.workspace.id, { includeArchived: true }),
    ]);
    setParts(nextParts);
    setItems(nextItems);
  }
  useEffect(() => {
    let active = true;
    void load().catch(() => { if (active) setError('Bestand konnte nicht geladen werden.'); });
    return () => { active = false; };
  }, [me.workspace.id]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const partId = String(data.get('partId') ?? '');
    const variantKey = String(data.get('variantKey') ?? '') || null;
    const label = String(data.get('label') ?? '').trim();
    if (!partId || !label) return;
    setBusy(true); setError('');
    try {
      await createStockItem(me.workspace.id, { partId, label, variantKey });
      form.reset();
      setCreatePartId('');
      await load();
    } catch {
      setError('Bestandsstück konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  }
  async function usable(item: StockItem, value: boolean) {
    const previous = items;
    setItems(current => current.map(candidate => candidate.id === item.id ? { ...candidate, usable: value } : candidate));
    setBusy(true); setError('');
    try {
      await updateStockItem(me.workspace.id, item.id, { usable: value });
      await load();
    } catch {
      setItems(previous);
      setError('Bestandsstück konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }
  return <section className="plans venue-library" aria-label="Bestand" data-testid="bestand-page">
    <div className="section-heading"><div><h2>Bestand</h2>
      <p className="muted">Physische Bestandsstücke und Bauteile des Arbeitsbereichs.</p></div></div>
    <div className="asset-tabs" role="tablist" aria-label="Bestand">
      <button type="button" role="tab" className="quiet" data-testid="bestand-tab-items" aria-selected={tab === 'items'} onClick={() => setTab('items')}>Bestandsstücke</button>
      <button type="button" role="tab" className="quiet" data-testid="bestand-tab-counts" aria-selected={tab === 'counts'} onClick={() => setTab('counts')}>Stückzahlen</button>
      <button type="button" role="tab" className="quiet" data-testid="bestand-tab-parts" aria-selected={tab === 'parts'} onClick={() => setTab('parts')}>Bauteile</button>
      <button type="button" role="tab" className="quiet" data-testid="bestand-tab-ballast" aria-selected={tab === 'hardware'} onClick={() => setTab('hardware')}>Beschwerung</button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {tab === 'counts' && <StockCounts workspaceId={me.workspace.id} parts={parts} readOnly={readOnly} />}
    {tab === 'hardware' && <BallastStock workspaceId={me.workspace.id} readOnly={readOnly} />}
    {tab === 'items' && <div className="inventory-panel" data-testid="bestand-items">
      {!readOnly && <form onSubmit={create}><fieldset disabled={busy}>
        <h3>Bestandsstück anlegen</h3>
        <label htmlFor="stock-label">Etikett</label><input id="stock-label" name="label" maxLength={120} required />
        <label htmlFor="stock-part">Bauteil</label><select id="stock-part" name="partId" required value={createPartId}
          onChange={event => setCreatePartId(event.target.value)}>
          <option value="" disabled>Bauteil wählen</option>
          {parts.filter(part => !part.archived && part.stock === 'item').map(part => <option key={part.id} value={part.id}>{part.name}</option>)}
        </select>
        {!!parts.find(part => part.id === createPartId)?.variants.length && <>
          <label htmlFor="stock-variant">Variante</label><select id="stock-variant" name="variantKey" required defaultValue="">
            <option value="" disabled>Variante wählen</option>
            {parts.find(part => part.id === createPartId)?.variants.map(variant =>
              <option key={variant.key} value={variant.key}>{variant.label}</option>)}
          </select>
        </>}
        <div className="form-actions"><button type="submit">Bestandsstück anlegen</button></div>
      </fieldset></form>}
      <table><thead><tr><th>Etikett</th><th>Bauteil</th><th>Variante</th><th>Status</th></tr></thead><tbody>
        {items.filter(item => !item.archived).map(item => <tr key={item.id}>
          <td>{item.label}</td><td>{item.partName}</td><td>{item.variantLabel ?? 'Standard'}</td>
          <td><label><input type="checkbox" checked={item.usable} disabled={readOnly || busy}
            onChange={event => void usable(item, event.target.checked)} /> verwendbar</label></td>
        </tr>)}
      </tbody></table>
      {!items.some(item => !item.archived) && <p className="muted">Noch keine Bestandsstücke.</p>}
    </div>}
    {tab === 'parts' && <div className="inventory-panel" data-testid="bestand-parts">
      <p className="muted">Bauteile werden im Bauteildesigner gepflegt; Starterteile sind in jedem Arbeitsbereich verfügbar.</p>
      <table><thead><tr><th>Bauteil</th><th>Kategorie</th><th>Revision</th><th>Bestandsart</th></tr></thead><tbody>
        {parts.filter(part => !part.archived).map(part => <tr key={part.id}>
          <td>{part.favourite ? '★ ' : ''}{part.name}</td><td>{part.category}</td><td>{part.latestRevision}</td>
          <td>{part.stock === 'item' ? 'Bestandsstück' : part.stock === 'count' ? 'Stückzahl' : 'ohne Bestand'}</td>
        </tr>)}
      </tbody></table>
    </div>}
  </section>;
}
