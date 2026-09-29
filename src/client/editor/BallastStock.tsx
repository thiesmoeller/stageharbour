import { useEffect, useState, type FormEvent } from 'react';
import { ballastStockSchema, type BallastStock as Stock } from '../../shared/ballast.js';
import { inventorySchema } from '../../shared/inventory.js';
import { ApiError, request } from '../api.js';
import { useEditingLease } from './useEditingLease.js';

export function BallastStock({ workspaceId, readOnly }: { workspaceId: string; readOnly: boolean }) {
  const base = `/api/workspaces/${workspaceId}/inventory`;
  const lease = useEditingLease(base, !readOnly);
  const [stock, setStock] = useState<Stock>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  async function load() {
    const data = inventorySchema.parse(await request(base));
    setStock(data.ballast); setVersion(value => value + 1);
  }
  useEffect(() => {
    let cancelled = false;
    request(base).then(data => { if (!cancelled) setStock(inventorySchema.parse(data).ballast); })
      .catch(() => { if (!cancelled) setError('Beschwerungsbestand konnte nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [base]);
  async function acquire() {
    setBusy(true); setError('');
    try { if (await lease.acquire()) await load(); }
    catch { setError('Beschwerungsbestand konnte nicht geladen werden.'); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = ballastStockSchema.safeParse({ slabs: Number(data.get('slabs')), straps: Number(data.get('straps')) });
    if (!parsed.success) { setError('Bitte ganze, nicht negative Stückzahlen eingeben.'); return; }
    setBusy(true); setError('');
    try { setStock(ballastStockSchema.parse(await request(`${base}/ballast`, parsed.data, 'PUT'))); setVersion(value => value + 1); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Bestand konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  return <div className="inventory-panel" data-testid="ballast-stock">
    <h3>Beschwerung</h3><p>Verfügbare Gehwegplatten und Spanngurte für Stützen.</p>
    {error && <p role="alert">{error}</p>}
    {lease.message && <p role="status">{lease.message}</p>}
    {!readOnly && !lease.holding && <button type="button" disabled={busy} onClick={() => void acquire()}>Bestand bearbeiten</button>}
    {stock && <form key={version} onSubmit={event => void save(event)}><fieldset disabled={!lease.holding || busy}>
      <label htmlFor="ballast-slabs">Gehwegplatten · 400 × 400 × 50 mm</label>
      <input id="ballast-slabs" name="slabs" type="number" min="0" max="2147483647" step="1" required defaultValue={stock.slabs} />
      <label htmlFor="ballast-straps">Spanngurte</label>
      <input id="ballast-straps" name="straps" type="number" min="0" max="2147483647" step="1" required defaultValue={stock.straps} />
      {!readOnly && <button type="submit">Speichern</button>}
    </fieldset></form>}
  </div>;
}
