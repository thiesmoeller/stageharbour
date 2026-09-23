import { useCallback, useEffect, useRef, useState } from 'react';

/** Tracks unapplied edits in Übernehmen forms so save status stays honest (U01). */
export function usePendingApplyForm(onPendingChange?: (pending: boolean) => void) {
  const [pending, setPending] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const onPendingChangeRef = useRef(onPendingChange);
  onPendingChangeRef.current = onPendingChange;

  useEffect(() => {
    onPendingChangeRef.current?.(pending);
    return () => { onPendingChangeRef.current?.(false); };
  }, [pending]);

  const markPending = useCallback(() => setPending(true), []);
  const clearPending = useCallback(() => setPending(false), []);
  const discard = useCallback(() => {
    setPending(false);
    setResetKey(key => key + 1);
  }, []);

  return {
    pending,
    resetKey,
    markPending,
    clearPending,
    discard,
    formProps: {
      onInput: markPending,
      onChange: markPending,
    },
  };
}

export const PENDING_DISCARD_CONFIRM = 'Nicht übernommene Eingaben verwerfen?';

export function confirmDiscardPending(pending: boolean): boolean {
  if (!pending) return true;
  return globalThis.confirm(PENDING_DISCARD_CONFIRM);
}
