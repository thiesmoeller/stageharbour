import type { Layout } from './layout.js';

export type LayoutCommand = { before: Layout; after: Layout };
export type History = { present: Layout; past: LayoutCommand[]; future: LayoutCommand[] };
export function history(layout: Layout): History { return { present: structuredClone(layout), past: [], future: [] }; }
export function execute(state: History, layout: Layout): History {
  if (JSON.stringify(state.present) === JSON.stringify(layout)) return state;
  const after = structuredClone(layout);
  return { present: after, past: [...state.past, { before: state.present, after }].slice(-100), future: [] };
}
export function undo(state: History): History {
  const command = state.past.at(-1);
  return command ? { present: command.before, past: state.past.slice(0, -1), future: [...state.future, command] } : state;
}
export function redo(state: History): History {
  const command = state.future.at(-1);
  return command ? { present: command.after, past: [...state.past, command], future: state.future.slice(0, -1) } : state;
}
