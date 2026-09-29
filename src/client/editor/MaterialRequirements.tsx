import { useEffect, useState } from 'react';
import { materialRequirementsSchema } from '../../shared/ballast.js';
import { request } from '../api.js';
import type { z } from 'zod';

export function MaterialRequirements({ workspaceId, productionId, venueId, revisionKey }: { workspaceId: string; productionId: string; venueId: string; revisionKey: string }) {
  const [data, setData] = useState<z.infer<typeof materialRequirementsSchema>>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setData(undefined); setError('');
    request(`/api/workspaces/${workspaceId}/productions/${productionId}/venues/${venueId}/requirements`)
      .then(value => { if (!cancelled) setData(materialRequirementsSchema.parse(value)); })
      .catch(() => { if (!cancelled) setError('Materialbedarf konnte nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [workspaceId, productionId, venueId, revisionKey]);
  return <details data-testid={`material-requirements-${venueId}`}><summary>Materialbedarf</summary>
    <p className="muted">Höchster Bedarf je Artikel über alle Szenen dieser Produktion an dieser Spielstätte.</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Lädt …</p>}
    {data && <table><thead><tr><th>Artikel</th><th>Benötigt</th><th>Verfügbar</th><th>Fehlend</th></tr></thead><tbody>
      <tr><td>Stützen</td><td>{data.required.braces}</td><td>—</td><td>—</td></tr>
      <tr><td>Gehwegplatten · 400 × 400 × 50 mm</td><td>{data.required.slabs}</td><td>{data.available.slabs}</td><td>{data.shortage.slabs}</td></tr>
      <tr><td>Spanngurte</td><td>{data.required.straps}</td><td>{data.available.straps}</td><td>{data.shortage.straps}</td></tr>
    </tbody></table>}
  </details>;
}
