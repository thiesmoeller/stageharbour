/**
 * The stage's shared asset state in the browser: one texture cache and one material factory for
 * every StageCanvas, so a texture used on several walls or in several canvases is fetched and
 * uploaded once. Tests build their own cache and factory.
 */
import { loadStageTexture } from './decoders.js';
import { createSurfaceMaterialFactory } from './surfaceMaterials.js';
import { createTextureCache } from './textureCache.js';

export const stageTextures = createTextureCache(loadStageTexture, (url, error) => {
  console.warn(`Stage texture could not be loaded: ${url}`, error);
});

export const stageMaterials = createSurfaceMaterialFactory(stageTextures);
