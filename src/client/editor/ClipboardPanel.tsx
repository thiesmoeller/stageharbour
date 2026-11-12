export function ClipboardPanel({ selection, canPaste, busy, readOnly, onCopy, onCut, onPaste }: {
  selection: { id: string }[]; canPaste: boolean; busy: boolean; readOnly: boolean;
  onCopy: () => void; onCut: () => void; onPaste: () => void;
}) {
  const canCopy = selection.length > 0;
  return <div className="clipboard-panel">
    <h3>Zwischenablage</h3>
    <p className="muted">Auf freiem Plan ziehen für Mehrfachauswahl · Shift hält die bisherige Auswahl{selection.length ? ` · ${selection.length} ausgewählt` : ''}.</p>
    {!readOnly && <div className="form-actions">
      <button type="button" disabled={busy || !canCopy} onClick={onCopy}>Kopieren</button>
      <button type="button" disabled={busy || !canCopy} onClick={onCut}>Ausschneiden</button>
      <button type="button" disabled={busy || !canPaste} onClick={onPaste}>Einfügen</button>
    </div>}
  </div>;
}
