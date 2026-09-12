import type { Layout } from './layout.js';

export type LayoutCommand<T = Layout> = { before: T; after: T };
export type History<T = Layout> = { present: T; past: LayoutCommand<T>[]; future: LayoutCommand<T>[] };
export function history<T>(layout: T): History<T> { return { present: structuredClone(layout), past: [], future: [] }; }
export function execute<T>(state: History<T>, layout: T): History<T> {
  if (JSON.stringify(state.present) === JSON.stringify(layout)) return state;
  const after = structuredClone(layout);
  return { present: after, past: [...state.past, { before: state.present, after }].slice(-100), future: [] };
}
export function undo<T>(state: History<T>): History<T> {
  const command = state.past.at(-1);
  return command ? { present: command.before, past: state.past.slice(0, -1), future: [...state.future, command] } : state;
}
export function redo<T>(state: History<T>): History<T> {
  const command = state.future.at(-1);
  return command ? { present: command.after, past: [...state.past, command], future: state.future.slice(0, -1) } : state;
}
