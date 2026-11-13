import type { Vec3 } from './cameraFraming.js';

/**
 * The three light themes the Raumsicht offers ("Umgebung"), as plain data.
 * Values are reproduced from @pascal-app/viewer 1.0.6 `SCENE_THEMES` (lib/scene-themes.js) and its
 * key-light shadow constants (components/viewer/lights.js), so ids match what Pascal persists today
 * under localStorage `viewer-preferences` → `state.sceneTheme`.
 */
export const LIGHT_THEME_IDS = ['studio', 'paper', 'sunset'] as const;
export type LightThemeId = typeof LIGHT_THEME_IDS[number];
export const DEFAULT_LIGHT_THEME_ID: LightThemeId = 'studio';

export type DirectionalLightSpec = { position: Vec3; target: Vec3; color: string; intensity: number };
export type ShadowSpec = {
  /** Shadow darkness; Pascal uses the key intensity when ≤ 1, otherwise 0.75. */
  intensity: number;
  bias: number;
  /** World units (metres). */
  normalBias: number;
  /** PCF softness radius. */
  radius: number;
  mapSize: number;
};

export type LightTheme = {
  id: LightThemeId;
  /** German label in the Darstellung panel. */
  label: string;
  /** Pascal's theme name, for reference when reading Pascal sources. */
  pascalName: string;
  /** Flat clear colour; what Pascal draws when post-processing is off (the default Raumsicht). */
  background: string;
  /** Zenith of Pascal's post-processing backdrop gradient ("Hohe Renderqualität" only). */
  backgroundSky: string;
  /** Ground tint, used by the solid ground option. */
  ground: string;
  ambient: { color: string; intensity: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  /** Shadow-casting key light. Position is a direction from the target; the shadow fit moves it. */
  key: DirectionalLightSpec;
  fill: DirectionalLightSpec;
  shadow: ShadowSpec;
  toneMappingExposure: number;
};

const ORIGIN: Vec3 = [0, 0, 0];
const PASCAL_MAX_SHADOW_INTENSITY = 0.75;
const shadowFor = (keyIntensity: number): ShadowSpec => ({
  intensity: keyIntensity <= 1 ? keyIntensity : PASCAL_MAX_SHADOW_INTENSITY,
  bias: -0.0005,
  normalBias: 0.08,
  radius: 2,
  mapSize: 1024,
});

export const LIGHT_THEMES: Readonly<Record<LightThemeId, LightTheme>> = {
  studio: {
    id: 'studio', label: 'Studio', pascalName: 'Studio',
    background: '#fbfbfa', backgroundSky: '#b6cfe7', ground: '#e9e7e2',
    ambient: { color: '#ffffff', intensity: 0.15 },
    hemisphere: { sky: '#ffffff', ground: '#aaa49a', intensity: 0.45 },
    key: { position: [10, 10, 10], target: ORIGIN, color: '#ffffff', intensity: 4 },
    fill: { position: [-10, 10, -10], target: ORIGIN, color: '#ffffff', intensity: 0.6 },
    shadow: shadowFor(4),
    toneMappingExposure: 0.9,
  },
  paper: {
    id: 'paper', label: 'Warm', pascalName: 'Paper',
    background: '#ede9df', backgroundSky: '#c0d2e4', ground: '#e7e1d3',
    ambient: { color: '#fff9eb', intensity: 0.55 },
    hemisphere: { sky: '#fff5d9', ground: '#c2b89c', intensity: 0.35 },
    key: { position: [16, 22, 12], target: ORIGIN, color: '#fff1c8', intensity: 2.6 },
    fill: { position: [-14, 10, -6], target: ORIGIN, color: '#dde5ff', intensity: 0.35 },
    shadow: shadowFor(2.6),
    toneMappingExposure: 1,
  },
  sunset: {
    id: 'sunset', label: 'Abend', pascalName: 'Sunset',
    background: '#f6e8d4', backgroundSky: '#b5bede', ground: '#ecd9bf',
    ambient: { color: '#ffd9a8', intensity: 0.45 },
    hemisphere: { sky: '#ffd9a8', ground: '#5b4634', intensity: 0.4 },
    key: { position: [22, 8, 8], target: ORIGIN, color: '#ffb070', intensity: 3.4 },
    fill: { position: [-14, 16, -10], target: ORIGIN, color: '#a4b8ff', intensity: 0.4 },
    shadow: shadowFor(3.4),
    toneMappingExposure: 1,
  },
};

export function isLightThemeId(value: unknown): value is LightThemeId {
  return typeof value === 'string' && (LIGHT_THEME_IDS as readonly string[]).includes(value);
}

/** Unknown ids fall back to Studio, as Pascal's `getSceneTheme` does. */
export function lightTheme(id: string | undefined): LightTheme {
  return LIGHT_THEMES[isLightThemeId(id) ? id : DEFAULT_LIGHT_THEME_ID];
}

/** Unit vector from the key light's target towards the light. */
export function keyLightDirection(theme: LightTheme): Vec3 {
  const [x, y, z] = theme.key.position, [tx, ty, tz] = theme.key.target;
  const dx = x - tx, dy = y - ty, dz = z - tz, length = Math.hypot(dx, dy, dz);
  return length > 0 ? [dx / length, dy / length, dz / length] : [0, 1, 0];
}
