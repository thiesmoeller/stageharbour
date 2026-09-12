import { useEffect, useRef, type RefObject } from 'react';

/** Native non-passive wheel so Ctrl+wheel can prevent browser page zoom. */
export function useViewportWheel(
  target: RefObject<Element | null>,
  onWheel: (event: WheelEvent) => void,
  enabled = true,
) {
  const handler = useRef(onWheel);
  handler.current = onWheel;
  useEffect(() => {
    const element = target.current;
    if (!element || !enabled) return;
    const listener = (event: Event) => handler.current(event as WheelEvent);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, [target, enabled]);
}

/** Keep wheel gestures inside a 3D canvas from zooming or scrolling the page. */
export function useBlockBrowserZoom(target: RefObject<Element | null>, enabled = true) {
  useViewportWheel(target, event => {
    event.preventDefault();
  }, enabled);
}
