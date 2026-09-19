import { useEffect, useState } from 'react';
import { z } from 'zod';
import { request } from './api.js';

const entries = z.array(z.object({ id: z.string(), actorId: z.string(), actorName: z.string().nullable(), action: z.string(), resourceId: z.string(), createdAt: z.string() }));
function label(action: string) {
  const area = action.includes('inventory') || action.includes('assets') ? 'Bestand' : action.includes('venue') ? 'Spielstätte' : action.includes('members') || action.includes('invitations') ? 'Mitglieder' : 'Szene';
  if (action.startsWith('lease.')) return `${area}: Bearbeitung ${action.includes('release') ? 'beendet' : action.includes('takeover') ? 'nach Ablauf übernommen' : 'begonnen'}`;
  if (action.includes('invitations')) return 'Mitglied eingeladen';
  if (action.includes('members')) return action.startsWith('DELETE') ? 'Mitgliedszugang entzogen' : 'Berechtigung geändert';
  if (action.includes('recover')) return 'Entwurf als Szenenvorlage gesichert';
  return `${area}: ${action.startsWith('DELETE') ? 'entfernt / archiviert' : action.startsWith('POST') ? 'angelegt' : 'gespeichert'}`;
}
export function AuditLog({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<z.infer<typeof entries>>([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    request(`/api/workspaces/${workspaceId}/audit`).then(data => { if (active) { setItems(entries.parse(data)); setError(''); } })
      .catch(() => { if (active) setError('Aktivitäten konnten nicht geladen werden.'); });
    return () => { active = false; };
  }, [workspaceId, attempt]);
  return <details className="members"><summary>Aktivitäten im Arbeitsbereich</summary>
    <p>Letzte 100 Änderungen und Bearbeitungsfreigaben.</p>
    <button className="quiet" onClick={() => setAttempt(value => value + 1)}>Aktivitäten aktualisieren</button>
    {error && <p role="alert">{error}</p>}
    <ul>{items.map(item => <li key={item.id}><time>{new Date(item.createdAt).toLocaleString('de-DE')}</time> · {item.actorName ?? 'Ehemaliges Mitglied'} · {label(item.action)}</li>)}</ul>
  </details>;
}
