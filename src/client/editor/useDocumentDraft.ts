import { recordFeedbackActivity } from '../feedback/activity.js';
import { useRef, useState, type SetStateAction } from 'react';
import { execute, history, redo, undo } from '../../shared/history.js';

/** One draft/history per document; previews never enter undo or persistence. */
export function useDocumentDraft<T>(initial: T) {
  const [state, setState] = useState(() => history(initial));
  const current = useRef(state); current.current = state;
  const [preview, setPreview] = useState<T>();
  const previewRef = useRef<T | undefined>(undefined);
  const base = useRef<T | undefined>(undefined);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const savedValue = useRef(initial);
  function commit(value: T) {
    if (base.current !== undefined) return;
    if (JSON.stringify(value) === JSON.stringify(current.current.present)) return;
    recordFeedbackActivity({ action: 'editor.change', area: 'venues' });
    const next = execute(current.current, value); current.current = next; setState(next);
  }
  function field<K extends keyof T>(key: K): [T[K], (value: SetStateAction<T[K]>) => void] {
    return [(preview ?? state.present)[key], value => {
      const document = previewRef.current ?? current.current.present;
      const next = { ...document, [key]: typeof value === 'function' ? (value as (old: T[K]) => T[K])(document[key]) : value };
      if (base.current) { previewRef.current = next; setPreview(next); } else commit(next);
    }];
  }
  return {
    value: preview ?? state.present, field,
    dirty: saved !== JSON.stringify(preview ?? state.present),
    canUndo: !!state.past.length, canRedo: !!state.future.length,
    isActive() { return base.current !== undefined; },
    begin() { if (base.current === undefined) { base.current = current.current.present; setPreview(current.current.present); } },
    preview(value: T) { previewRef.current = value; setPreview(value); },
    commit,
    finish(cancel = false) { base.current = undefined; if (!cancel && previewRef.current) commit(previewRef.current); previewRef.current = undefined; setPreview(undefined); },
    undo() { if (base.current !== undefined) return; const next = undo(current.current); current.current = next; setState(next); },
    redo() { if (base.current !== undefined) return; const next = redo(current.current); current.current = next; setState(next); },
    discard() { const next = history(savedValue.current); current.current = next; setState(next); base.current = undefined; previewRef.current = undefined; setPreview(undefined); },
    /** Mark only the submitted snapshot saved so edits during the request stay dirty. */
    markSaved(acknowledged: T) { savedValue.current = acknowledged; setSaved(JSON.stringify(acknowledged)); },
  };
}
