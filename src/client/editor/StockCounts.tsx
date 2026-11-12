import { useEffect, useState, type FormEvent } from 'react';
import type { PartSummary, SetStockCountRequest, StockCount } from '../../shared/parts/catalog.js';
import type { PartMaterial } from '../../shared/parts/definition.js';
import { listMaterials, listStockCounts, setStockCount } from '../partsApi.js';

type CountTarget = { materialKey: string } | { partId: string; variantKey: string | null };
type CountRow = { key: string; name: string; variantLabel: string | null; quantity: number | null; target: CountTarget };

const rowKey = (target: CountTarget) =>
  'materialKey' in target ? `material:${target.materialKey}` : `part:${target.partId}:${target.variantKey ?? ''}`;

/** Counted stock: count-stocked parts per variant and pieces of hardware such as ballast slabs. */
export function StockCounts({ workspaceId, parts, readOnly }: { workspaceId: string; parts: readonly PartSummary[]; readOnly: boolean }) {
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [materials, setMaterials] = useState<PartMaterial[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const [nextCounts, nextMaterials] = await Promise.all([listStockCounts(workspaceId), listMaterials(workspaceId)]);
    setCounts(nextCounts);
    setMaterials(nextMaterials);
  }
  useEffect(() => {
    let active = true;
    void load().catch(() => { if (active) setError('Stückzahlen konnten nicht geladen werden.'); });
    return () => { active = false; };
  }, [workspaceId]);
  const stored = new Map(counts.map(count => [rowKey(count.materialKey
    ? { materialKey: count.materialKey } : { partId: count.partId!, variantKey: count.variantKey }), count]));
  const candidates: CountRow[] = [
    ...parts.filter(part => !part.archived && part.stock === 'count').flatMap(part =>
      (part.variants.length ? part.variants : [{ key: null, label: null }]).map(variant => {
        const target = { partId: part.id, variantKey: variant.key };
        return { key: rowKey(target), name: part.name, variantLabel: variant.label, quantity: null, target };
      })),
    ...materials.filter(material => material.kind === 'hardware' && material.weightKgPerPiece > 0).map(material => {
      const target = { materialKey: material.key };
      return { key: rowKey(target), name: material.name, variantLabel: null, quantity: null, target };
    }),
  ];
  const rows = candidates.map(row => ({ ...row, quantity: stored.get(row.key)?.quantity ?? null }));
  async function save(event: FormEvent<HTMLFormElement>, row: CountRow) {
    event.preventDefault();
    const quantity = Number(new FormData(event.currentTarget).get('quantity'));
    if (!Number.isInteger(quantity) || quantity < 0) return;
    setBusy(true); setError('');
    try {
      await setStockCount(workspaceId, { ...row.target, quantity } satisfies SetStockCountRequest);
      await load();
    } catch {
      setError('Stückzahl konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }
  return <div className="inventory-panel" data-testid="bestand-counts">
    <p className="muted">Gezählter Bestand. Ohne Stückzahl wird kein Fehlbestand gemeldet.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <table><thead><tr><th>Artikel</th><th>Variante</th><th>Im Bestand</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.key}>
        <td>{row.name}</td><td>{row.variantLabel ?? '—'}</td>
        <td><form className="inline-form" onSubmit={event => void save(event, row)}><fieldset disabled={readOnly || busy}>
          <input name="quantity" type="number" min={0} step={1} defaultValue={row.quantity ?? ''} key={`${row.key}:${row.quantity}`}
            aria-label={`Stückzahl ${row.name}${row.variantLabel ? ` · ${row.variantLabel}` : ''}`} required />
          {!readOnly && <button type="submit" className="quiet">Speichern</button>}
        </fieldset></form></td>
      </tr>)}
    </tbody></table>
  </div>;
}
