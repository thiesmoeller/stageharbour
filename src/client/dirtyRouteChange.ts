/** Pure helpers for dirty-editor hash navigation (see main.tsx hashchange guard). */

/** Shown when hash navigation would leave a dirty scene/venue editor. */
export const UNSAVED_ROUTE_LEAVE_CONFIRM = 'Nicht gespeicherte Änderungen verwerfen und den Ort wechseln?';

/** Pure: whether a dirty editor should block applying a new hash route. */
export function shouldBlockDirtyRouteChange(dirty: boolean, currentHash: string, nextHash: string): boolean {
  return dirty && currentHash !== nextHash;
}
