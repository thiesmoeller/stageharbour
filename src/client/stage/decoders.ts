/**
 * Loaders for compressed stage assets. Every decoder is served by the app itself; no CDN is
 * contacted.
 *
 * - KTX2/Basis and Draco: with no transcoder or decoder path set, three's loaders resolve their
 *   binaries next to themselves with `new URL(..., import.meta.url)`, which the build copies into
 *   the app's assets. Do not set a path here: tests/stage-renderer.test.ts and the assets journey
 *   (tests/browser/assets.spec.ts) check that no decoder is fetched from another host.
 * - Meshopt: the decoder module carries its wasm inline.
 */
import { TextureLoader } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { onStageRenderer } from './renderer.js';
import type { TextureLoad } from './textureCache.js';

const ktx2Loader = new KTX2Loader().setWorkerLimit(2);
const imageLoader = new TextureLoader();
let dracoLoader: DRACOLoader | undefined;

let ktx2Detected = false;
let announceKtx2Ready: () => void = () => {};
const ktx2Ready = new Promise<void>(resolve => { announceKtx2Ready = resolve; });

// Which compressed formats the transcoder targets depends on the GPU, so KTX2 requests wait for
// the first renderer. Every stage renderer runs on the same GPU; one detection serves them all.
onStageRenderer(renderer => {
  if (ktx2Detected) return;
  ktx2Detected = true;
  ktx2Loader.detectSupport(renderer);
  announceKtx2Ready();
});

export function isKtx2Url(url: string) {
  return /\.ktx2(?:$|[?#])/i.test(url);
}

/** Loads KTX2 through the Basis transcoder and everything else as a browser image. */
export const loadStageTexture: TextureLoad = (url, onLoad, onError) => {
  if (!isKtx2Url(url)) {
    imageLoader.load(url, onLoad, undefined, onError);
    return;
  }
  void ktx2Ready.then(() => { ktx2Loader.load(url, onLoad, undefined, onError); }).catch(onError);
};

/** Extends a GLTFLoader with Draco, KTX2 and Meshopt decoding. Use as R3F's `useLoader` extension. */
export function configureStageGltfLoader(loader: GLTFLoader) {
  dracoLoader ??= new DRACOLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.setKTX2Loader(ktx2Loader);
  loader.setMeshoptDecoder(MeshoptDecoder);
}
