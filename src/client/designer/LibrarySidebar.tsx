import { useMemo, useRef, useState } from 'react';
import type { ImportReport, PartSummary } from '../../shared/parts/catalog.js';
import { STARTER_PARTS } from '../../shared/parts/starter/index.js';
import { archivePart, exportLibrary, importLibrary, setPartFavourite, unarchivePart } from '../partsApi.js';

function download(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImportReportView({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const line = (label: string, parts: { name: string; revision?: number }[]) => parts.length > 0 && <li>
    <strong>{parts.length} {label}:</strong> {parts.map(part => part.revision ? `${part.name} (Rev. ${part.revision})` : part.name).join(', ')}
  </li>;
  const materials = report.materials;
  return <div className="designer-import-report" role="status" data-testid="designer-import-report">
    <p><strong>Import abgeschlossen</strong></p>
    <ul>
      {line('neu angelegt', report.created)}
      {line('überarbeitet', report.revised)}
      {line('unverändert', report.skipped)}
      {report.rejected.map(part => <li key={part.id} className="error">
        Abgelehnt: {part.name} (Rev. {part.fileRevision}) – {part.issues.slice(0, 3).map(item => item.message).join(' · ')}
      </li>)}
      {materials.created.length > 0 && <li>Materialien neu: {materials.created.join(', ')}</li>}
      {materials.overwritten.length > 0 && <li>Materialien überschrieben: {materials.overwritten.join(', ')}</li>}
      {materials.skipped.length > 0 && <li>Materialien beibehalten: {materials.skipped.join(', ')}</li>}
    </ul>
    <button type="button" className="quiet" onClick={onClose}>Schließen</button>
  </div>;
}

/** Workspace part library: search, filters, favourites, archive, create, duplicate, import and export. */
export function LibrarySidebar({ workspaceId, parts, currentId, readOnly, onOpen, onNew, onDuplicate, onChanged, onImported }: {
  workspaceId: string;
  parts: readonly PartSummary[];
  currentId: string | undefined;
  readOnly: boolean;
  onOpen: (partId: string) => void;
  onNew: () => void;
  onDuplicate: (partId: string) => void;
  onChanged: () => void;
  onImported: (report: ImportReport) => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ImportReport>();
  const [overwriteMaterials, setOverwriteMaterials] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => [...new Set(parts.map(part => part.category))].sort((a, b) => a.localeCompare(b, 'de')), [parts]);
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('de');
    return parts
      .filter(part => showArchived || !part.archived)
      .filter(part => !favouritesOnly || part.favourite)
      .filter(part => !category || part.category === category)
      .filter(part => !needle || `${part.name} ${part.category}`.toLocaleLowerCase('de').includes(needle))
      .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.category.localeCompare(b.category, 'de') || a.name.localeCompare(b.name, 'de'));
  }, [parts, search, category, favouritesOnly, showArchived]);
  const current = parts.find(part => part.id === currentId);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Aktion fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  async function exportParts(partIds?: string[]) {
    setBusy(true); setError('');
    try {
      const result = await exportLibrary(workspaceId, partIds ? { partIds } : {});
      download(result.filename, result.library);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Export fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  async function importFile(file: File) {
    setBusy(true); setError(''); setReport(undefined);
    try {
      let library: unknown;
      try { library = JSON.parse(await file.text()); }
      catch { throw new Error('Die Datei ist kein gültiges JSON.'); }
      const result = await importLibrary(workspaceId, library, { overwriteMaterials });
      setReport(result);
      onChanged();
      onImported(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import fehlgeschlagen.'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  return <aside className="designer-library" aria-label="Bauteilbibliothek" data-testid="designer-library">
    <div className="designer-library-head">
      <h2>Bibliothek</h2>
      {!readOnly && <button type="button" onClick={onNew} disabled={busy}>Neu</button>}
    </div>
    <input type="search" aria-label="Bauteile durchsuchen" placeholder="Suchen …" value={search} onChange={event => setSearch(event.target.value)} />
    <div className="designer-library-filters">
      <select aria-label="Kategorie" value={category} onChange={event => setCategory(event.target.value)}>
        <option value="">Alle Kategorien</option>
        {categories.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <label className="checkbox-line"><input type="checkbox" checked={favouritesOnly} onChange={event => setFavouritesOnly(event.target.checked)} />Nur Favoriten</label>
      <label className="checkbox-line"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Archivierte zeigen</label>
    </div>
    <ul className="designer-part-list" data-testid="designer-part-list">
      {visible.map(part => <li key={part.id} className={[part.id === currentId ? 'current' : '', part.archived ? 'archived' : ''].join(' ').trim() || undefined}>
        <button type="button" className="part-open" aria-current={part.id === currentId ? 'true' : undefined} onClick={() => onOpen(part.id)}>
          <span className="part-name">{part.name}</span>
          <span className="part-meta">{part.category} · Rev. {part.latestRevision}{part.archived ? ' · archiviert' : ''}</span>
        </button>
        <button type="button" className={part.favourite ? 'quiet icon-button favourite on' : 'quiet icon-button favourite'} disabled={readOnly || busy}
          aria-pressed={part.favourite} aria-label={part.favourite ? `${part.name} aus Favoriten entfernen` : `${part.name} als Favorit markieren`}
          onClick={() => run(() => setPartFavourite(workspaceId, part.id, !part.favourite))}>{part.favourite ? '★' : '☆'}</button>
      </li>)}
      {!visible.length && <li className="muted">Keine Bauteile gefunden.</li>}
    </ul>
    {current && !readOnly && <div className="designer-actions">
      <button type="button" className="quiet" disabled={busy} onClick={() => onDuplicate(current.id)}>Duplizieren</button>
      <button type="button" className="quiet" disabled={busy} onClick={() => run(() => current.archived ? unarchivePart(workspaceId, current.id) : archivePart(workspaceId, current.id))}>
        {current.archived ? 'Wiederherstellen' : 'Archivieren'}
      </button>
    </div>}
    <section className="designer-exchange" aria-label="Austausch">
      <h3>Austausch</h3>
      <div className="designer-actions">
        <button type="button" className="quiet" disabled={busy || !current} onClick={() => current && exportParts([current.id])}>Exportieren</button>
        <button type="button" className="quiet" disabled={busy} onClick={() => exportParts()}>Alle exportieren</button>
        {!readOnly && <button type="button" className="quiet" disabled={busy} onClick={() => fileInput.current?.click()}>Importieren</button>}
      </div>
      {!readOnly && <label className="checkbox-line"><input type="checkbox" checked={overwriteMaterials} onChange={event => setOverwriteMaterials(event.target.checked)} />
        Vorhandene Materialien überschreiben</label>}
      <input ref={fileInput} type="file" accept=".json,application/json" hidden data-testid="designer-import-file"
        onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      {report && <ImportReportView report={report} onClose={() => setReport(undefined)} />}
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="designer-starters" aria-label="Beispielbibliothek" data-testid="designer-starters">
      <h3>Beispielbibliothek</h3>
      <p className="muted">Mitgelieferte Bauteile. Als Kopie anlegen, um eine eigene Fassung zu bearbeiten.</p>
      <ul>
        {STARTER_PARTS.map(part => <li key={part.id}>
          <span className="part-name">{part.name}</span>
          <span className="designer-actions">
            <button type="button" className="quiet" onClick={() => onOpen(part.id)}>Öffnen</button>
            {!readOnly && <button type="button" className="quiet" disabled={busy} onClick={() => onDuplicate(part.id)}
              aria-label={`${part.name} als Kopie anlegen`}>Als Kopie anlegen</button>}
          </span>
        </li>)}
      </ul>
    </section>
  </aside>;
}
