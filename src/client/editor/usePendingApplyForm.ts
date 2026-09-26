import { useCallback, useEffect, useRef, useState } from 'react';
import { askConfirm } from '../ConfirmDialog.js';

/** Ref-count helper for aggregating multiple Übernehmen forms into one dirty flag. */
export function adjustPendingCount(count: number, pending: boolean): number {
  const next = count + (pending ? 1 : -1);
  return next < 0 ? 0 : next;
}

/** Tracks unapplied edits in Übernehmen forms so save status stays honest (U01). */
export function usePendingApplyForm(onPendingChange?: (pending: boolean) => void) {
  const [pending, setPending] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const onPendingChangeRef = useRef(onPendingChange);
  onPendingChangeRef.current = onPendingChange;
  /** Last value reported to the parent — avoids double ±1 and races with useEffect. */
  const reportedRef = useRef(false);

  const report = useCallback((next: boolean) => {
    if (reportedRef.current === next) return;
    reportedRef.current = next;
    onPendingChangeRef.current?.(next);
  }, []);

  // Sync notify on mark/clear so selection guards see the update in the same event turn
  // (useEffect would run after paint and race with Auswahl changes right after Übernehmen).
  const markPending = useCallback(() => {
    setPending(true);
    report(true);
  }, [report]);
  const clearPending = useCallback(() => {
    setPending(false);
    report(false);
  }, [report]);
  const discard = useCallback(() => {
    setPending(false);
    report(false);
    setResetKey(key => key + 1);
  }, [report]);

  useEffect(() => () => { report(false); }, [report]);

  return {
    pending,
    resetKey,
    markPending,
    clearPending,
    discard,
    formProps: {
      onInput: markPending,
    },
  };
}

export const PENDING_DISCARD_CONFIRM = 'Nicht übernommene Eingaben verwerfen?';

/** Ask before discarding unapplied Übernehmen edits. Resolves true when nothing is pending or the user confirms. */
export async function confirmDiscardPending(pending: boolean): Promise<boolean> {
  if (!pending) return true;
  return askConfirm({
    title: 'Eingaben verwerfen?',
    message: PENDING_DISCARD_CONFIRM,
    confirmLabel: 'Verwerfen',
    cancelLabel: 'Weiter bearbeiten',
    danger: true,
  });
}
