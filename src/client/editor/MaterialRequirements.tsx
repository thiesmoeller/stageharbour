import { useEffect, useState } from 'react';
import { materialRequirementsSchema } from '../../shared/ballast.js';
import { buildListsSchema, type BuildLists } from '../../shared/partLists.js';
import { request } from '../api.js';
import type { z } from 'zod';

export function MaterialRequirements({ workspaceId, productionId, venueId, revisionKey }: { workspaceId: string; productionId: string; venueId: string; revisionKey: string }) {
  const [data, setData] = useState<z.infer<typeof materialRequirementsSchema>>();
  const [demand, setDemand] = useState<BuildLists>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setData(undefined); setDemand(undefined); setError('');
    const visit = `/api/workspaces/${workspaceId}/productions/${productionId}/venues/${venueId}`;
    Promise.all([request(`${visit}/requirements`), request(`${visit}/stock-demand`)])
      .then(([value, lists]) => {
        if (cancelled) return;
        setData(materialRequirementsSchema.parse(value));
        setDemand(buildListsSchema.parse(lists));
      })
      .catch(() => { if (!cancelled) setError('Materialbedarf konnte nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [workspaceId, productionId, venueId, revisionKey]);
  const warnings = demand?.stock.warnings.filter(warning => warning.kind !== 'shortage' && warning.kind !== 'unassigned') ?? [];
  return <details data-testid={`material-requirements-${venueId}`}><summary>Materialbedarf</summary>
    <p className="muted">Höchster Bedarf je Artikel über alle Bühnenbilder dieser Produktion an dieser Spielstätte.</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Lädt …</p>}
    {data && <table><thead><tr><th>Artikel</th><th>Benötigt</th><th>Verfügbar</th><th>Fehlend</th></tr></thead><tbody>
      <tr><td>Stützen</td><td>{data.required.braces}</td><td>—</td><td>—</td></tr>
      <tr><td>Gehwegplatten · 400 × 400 × 50 mm</td><td>{data.required.slabs}</td><td>{data.available.slabs}</td><td>{data.shortage.slabs}</td></tr>
      <tr><td>Spanngurte</td><td>{data.required.straps}</td><td>{data.available.straps}</td><td>{data.shortage.straps}</td></tr>
    </tbody></table>}
    {demand && <div className="stock-demand" data-testid={`stock-demand-${venueId}`}>
      <h4>Bestandsbedarf</h4>
      {demand.stock.rows.length ? <table><thead><tr><th>Bauteil / Material</th><th>Variante</th><th>Benötigt</th><th>Zugeordnet</th><th>Im Bestand</th><th>Fehlend</th></tr></thead><tbody>
        {demand.stock.rows.map(row => <tr key={row.key} className={row.shortage ? 'shortage' : undefined}>
          <td>{row.name}</td><td>{row.variantLabel ?? '—'}</td><td>{row.required}</td>
          <td>{row.assigned ?? '—'}</td><td>{row.available ?? 'nicht gezählt'}</td><td>{row.shortage || '—'}</td>
        </tr>)}
      </tbody></table> : <p className="muted">Keine Bauteile mit Bestand.</p>}
      {warnings.length > 0 && <ul className="warning">{warnings.map(warning => <li key={`${warning.kind}:${warning.key}:${warning.scene?.id ?? ''}`}>
        {warning.scene ? `${warning.scene.name}: ` : ''}{warning.message}
      </li>)}</ul>}
    </div>}
  </details>;
}
