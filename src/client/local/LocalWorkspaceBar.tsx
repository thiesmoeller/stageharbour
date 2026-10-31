import { useRef, useState } from 'react';
import { askConfirm } from '../ConfirmDialog.js';
import { getLocalStore } from './boot.js';
import { loadWorkspaceFromDisk, saveWorkspaceToDisk } from './fileBackup.js';
import { localCapabilities } from './mode.js';

const BANNER_KEY = 'stageharbour-local-banner-dismissed';

function bannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(BANNER_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissBanner(): void {
  try {
    sessionStorage.setItem(BANNER_KEY, '1');
  } catch { /* sessionStorage may be unavailable */ }
}

export function LocalWorkspaceBar() {
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const [bannerOpen, setBannerOpen] = useState(() => !bannerDismissed());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!localCapabilities.local) return null;

  async function save() {
    setBusy(true);
    setError('');
    try {
      const handle = await saveWorkspaceToDisk(getLocalStore().getSnapshot(), handleRef.current);
      handleRef.current = handle;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const ok = await askConfirm({
      title: 'Arbeitsbereich laden?',
      message: 'Der aktuelle lokale Stand wird durch die Datei ersetzt. Ungespeicherte Änderungen gehen verloren.',
      confirmLabel: 'Datei laden',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const snapshot = await loadWorkspaceFromDisk();
      await getLocalStore().replaceSnapshot(snapshot);
      window.location.reload();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Laden fehlgeschlagen.');
      setBusy(false);
    }
  }

  async function reset() {
    const ok = await askConfirm({
      title: 'Auf Beispiel zurücksetzen?',
      message: 'Der lokale Arbeitsbereich wird gelöscht und durch die Beispiel-Theatergruppe ersetzt. Das lässt sich nicht rückgängig machen.',
      confirmLabel: 'Zurücksetzen',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await getLocalStore().resetToSeed();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Zurücksetzen fehlgeschlagen.');
      setBusy(false);
    }
  }

  return <div className="local-workspace-bar">
    {bannerOpen && <div className="local-banner" role="status">
      <p>Lokal auf diesem Gerät. Speichern/Laden als Datei sichert eine Kopie. Kein PDF, keine Cloud, nicht die private Installation.</p>
      <button type="button" className="quiet" onClick={() => { dismissBanner(); setBannerOpen(false); }}>Verstanden</button>
    </div>}
    <div className="local-workspace-actions">
      <button type="button" className="quiet" disabled={busy} onClick={() => void save()}>Arbeitsbereich speichern…</button>
      <button type="button" className="quiet" disabled={busy} onClick={() => void load()}>Arbeitsbereich laden…</button>
      <button type="button" className="quiet" disabled={busy} onClick={() => void reset()}>Auf Beispiel zurücksetzen</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
