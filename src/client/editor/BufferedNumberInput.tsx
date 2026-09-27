import { useEffect, useState } from 'react';
import { usePendingApplyForm } from './usePendingApplyForm.js';

/** Preserve incomplete numeric text; commit one validated change on blur/Enter. */
export function BufferedNumberInput({ value, label, onCommit, onPendingChange }: {
  value: number; label: string; onCommit: (value: number) => void; onPendingChange: (pending: boolean) => void;
}) {
  const [text, setText] = useState(String(value));
  const { pending, markPending, clearPending } = usePendingApplyForm(onPendingChange);
  useEffect(() => { if (!pending) setText(String(value)); }, [value, pending]);
  function cancel() { setText(String(value)); clearPending(); }
  function commit() {
    if (!pending) return;
    const next = Number(text);
    if (!text.trim() || !Number.isFinite(next)) { cancel(); return; }
    clearPending();
    onCommit(next);
    // Optimistic text until the parent (and any snap) publishes the committed value.
    setText(String(next));
  }
  return <input aria-label={label} type="number" step="any" value={text}
    onChange={event => { setText(event.target.value); markPending(); }} onBlur={commit}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    }} />;
}
