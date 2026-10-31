import { useEffect, useRef, useState } from 'react';
import { exportRevisionSchema } from '../../shared/export.js';
import type { DocumentDraft } from '../../shared/exportDocument.js';
import { ApiError, request } from '../api.js';

type PreparedJob = {
  id: string; status: string; stage: string; pageCount: number | null; error: string | null;
  manifest: { pageCount?: number; diagnostics?: string[]; sheets?: { title: string; index: number; sourceKey?: string | null; pageId?: string | null }[] } | null;
};
export type DocumentProof = { job: PreparedJob; url: string; key: string; issued: boolean };

/** A proof belongs to its exact inputs. Old/slow requests never become a current proof. */
export function useDocumentProof(workspaceId: string) {
  const [proof, setProof] = useState<DocumentProof>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busyRef = useRef(false);
  const currentUrl = useRef<string | undefined>(undefined);
  const urls = useRef(new Set<string>());
  const pendingJob = useRef<string | undefined>(undefined);
  useEffect(() => () => {
    generation.current += 1;
    for (const url of urls.current) URL.revokeObjectURL(url);
    if (pendingJob.current) void request(`/api/workspaces/${workspaceId}/documents/${pendingJob.current}/cancel`, {}).catch(() => {});
  }, [workspaceId]);

  async function prepare(draft: DocumentDraft, key: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    const version = ++generation.current;
    setBusy(true); setError('');
    try {
      let job = await request(`/api/workspaces/${workspaceId}/documents`, {
        ...draft.spec, revisionName: draft.spec.revisionName.trim(), viewImages: draft.viewImages,
        introduction: draft.spec.introduction?.trim() || undefined, contact: draft.spec.contact?.trim() || undefined,
      }) as PreparedJob;
      if (version !== generation.current) {
        void request(`/api/workspaces/${workspaceId}/documents/${job.id}/cancel`, {}).catch(() => {});
        return;
      }
      pendingJob.current = job.id;
      const deadline = Date.now() + 125_000;
      while (job.status === 'queued' || job.status === 'rendering') {
        if (version !== generation.current) return;
        if (Date.now() > deadline) throw new Error('Die Vorbereitung dauert zu lange. Bitte erneut versuchen.');
        await new Promise(resolve => window.setTimeout(resolve, 300));
        if (version !== generation.current) return;
        job = await request(`/api/workspaces/${workspaceId}/documents/${job.id}`) as PreparedJob;
      }
      if (job.status !== 'ready') throw new Error(job.error || 'Die Druckvorschau konnte nicht erstellt werden.');
      const response = await fetch(`/api/workspaces/${workspaceId}/documents/${job.id}/file`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Die Druckvorschau konnte nicht geladen werden.');
      const blob = await response.blob();
      if (version !== generation.current) return;
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      if (currentUrl.current) { URL.revokeObjectURL(currentUrl.current); urls.current.delete(currentUrl.current); }
      currentUrl.current = url;
      setProof({ job, url, key, issued: false });
    } catch (caught) {
      if (version === generation.current) setError(caught instanceof Error ? caught.message : 'Die Vorbereitung ist fehlgeschlagen.');
    } finally {
      if (version === generation.current) { pendingJob.current = undefined; busyRef.current = false; setBusy(false); }
    }
  }

  async function download(currentKey: string, filename: string) {
    if (!proof || proof.key !== currentKey || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError('');
    try {
      exportRevisionSchema.parse(await request(`/api/workspaces/${workspaceId}/documents/${proof.job.id}/issue`, {}));
      setProof(current => current?.key === proof.key ? { ...current, issued: true } : current);
      const link = document.createElement('a');
      link.href = proof.url; link.download = `${filename.replace(/[^\wÄÖÜäöüß-]+/g, '_') || 'Buehnenplan'}.pdf`;
      document.body.append(link); link.click(); link.remove();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 409 || caught.status === 404)) {
        setProof(current => current?.key === proof.key ? { ...current, key: '' } : current);
      }
      setError(caught instanceof Error ? caught.message : 'Das PDF konnte nicht exportiert werden.');
    } finally { busyRef.current = false; setBusy(false); }
  }
  return { proof, busy, error, prepare, download };
}
