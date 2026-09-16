export function editingText(target: EventTarget | null) {
  return target instanceof HTMLElement && (!!target.closest('input, textarea, select') || target.isContentEditable);
}

export function editorCommand(event: KeyboardEvent) {
  if (editingText(event.target)) return;
  if (event.key === 'Escape') return 'cancel';
  if (event.key === 'Delete' || event.key === 'Backspace') return 'delete';
  if (!(event.ctrlKey || event.metaKey)) return;
  switch (event.key.toLowerCase()) {
    case 'z': return event.shiftKey ? 'redo' : 'undo';
    case 'y': return 'redo';
    case 'c': return 'copy';
    case 'x': return 'cut';
    case 'v': return 'paste';
  }
}
