/**
 * Undo steps of the open model. A gesture or a typed value is one step; consecutive text edits
 * of the same field within a moment merge into one.
 */
export type History<T> = { past: T[]; future: T[]; lastTag?: string; lastAt?: number };

export const HISTORY_LIMIT = 200;
const MERGE_MS = 1200;

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/** Records `before` as an undo step. A `tag` equal to the previous one within a moment merges. */
export function record<T>(history: History<T>, before: T, tag?: string, now = Date.now()): History<T> {
  if (tag !== undefined && tag === history.lastTag && history.lastAt !== undefined && now - history.lastAt < MERGE_MS) {
    return { ...history, future: [], lastAt: now };
  }
  return { past: [...history.past, before].slice(-HISTORY_LIMIT), future: [], lastTag: tag, lastAt: now };
}

export function undo<T>(history: History<T>, current: T): { history: History<T>; value: T } | undefined {
  const value = history.past[history.past.length - 1];
  if (value === undefined) return undefined;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, value };
}

export function redo<T>(history: History<T>, current: T): { history: History<T>; value: T } | undefined {
  const [value, ...future] = history.future;
  if (value === undefined) return undefined;
  return { history: { past: [...history.past, current], future }, value };
}
