/** Both plan views use the same pointer-anchored zoom and wheel-pan mapping. */
export function navigatePlan(event: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'deltaX' | 'deltaY'>,
  view: { zoom: number; pan: { x: number; y: number }; centre: { x: number; y: number } }, cursor: { x: number; y: number },
) {
  const { zoom, pan, centre } = view;
  if (event.ctrlKey || event.metaKey) {
    const next = Math.min(8, Math.max(.4, zoom * Math.exp(-event.deltaY * .0015)));
    const ratio = zoom / next;
    return { zoom: next, pan: { x: cursor.x - (cursor.x - centre.x - pan.x) * ratio - centre.x, y: cursor.y - (cursor.y - centre.y - pan.y) * ratio - centre.y } };
  }
  // Bare wheel (two-finger trackpad) and Shift+wheel pan in plan units.
  return { zoom, pan: { x: pan.x + event.deltaX * 2 / zoom, y: pan.y - event.deltaY * 2 / zoom } };
}
