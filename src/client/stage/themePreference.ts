import { DEFAULT_LIGHT_THEME_ID, isLightThemeId, type LightThemeId } from './lightThemes.js';
import { scopedStorageKey } from '../local/storageScope.js';

/** Where the Raumsicht keeps the chosen "Umgebung". */
export const THEME_STORAGE_KEY = scopedStorageKey('stage-planner.raumsicht.theme');
/** Where Pascal's viewer persisted it (zustand persist: `{ state: { sceneTheme } }`). Read-only. */
export const LEGACY_THEME_STORAGE_KEY = 'viewer-preferences';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): ThemeStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

function legacyTheme(storage: ThemeStorage): LightThemeId | undefined {
  const raw = storage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as { state?: { sceneTheme?: unknown } } | null;
  const theme = parsed?.state?.sceneTheme;
  return isLightThemeId(theme) ? theme : undefined;
}

/**
 * The stored theme: the app's own key first, then what Pascal's viewer had saved on this device,
 * then Studio. Storage that is unavailable or unreadable counts as empty.
 */
export function readStoredTheme(storage: ThemeStorage | undefined = browserStorage()): LightThemeId {
  if (!storage) return DEFAULT_LIGHT_THEME_ID;
  try {
    const own = storage.getItem(THEME_STORAGE_KEY);
    if (isLightThemeId(own)) return own;
    return legacyTheme(storage) ?? DEFAULT_LIGHT_THEME_ID;
  } catch {
    return DEFAULT_LIGHT_THEME_ID;
  }
}

export function storeTheme(theme: LightThemeId, storage: ThemeStorage | undefined = browserStorage()) {
  try { storage?.setItem(THEME_STORAGE_KEY, theme); } catch { /* Private browsing may disable storage. */ }
}
