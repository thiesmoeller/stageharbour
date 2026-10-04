import { useEffect, useState } from 'react';

/** Matches the tablet/phone breakpoint where the dock overlays a single canvas. */
export const NARROW_EDITOR_QUERY = '(max-width: 1100px)';

export function useNarrowEditor(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_EDITOR_QUERY).matches : false,
  );
  useEffect(() => {
    const media = window.matchMedia(NARROW_EDITOR_QUERY);
    function sync() { setNarrow(media.matches); }
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return narrow;
}

/** Prefer a single canvas on narrow screens; keep plan when leaving stage placement. */
export function canvasModeForWidth(
  mode: 'split' | 'plan' | 'stage',
  narrow: boolean,
  prefer: 'plan' | 'stage' = 'plan',
): 'split' | 'plan' | 'stage' {
  if (!narrow) return mode;
  if (mode === 'split') return prefer;
  return mode;
}
