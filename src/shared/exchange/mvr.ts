import { exportObject3DGlb } from './gltf.js';
import { sceneGeometryToObject3D, type SceneMesh, type SceneMeshEntry } from './sceneMesh.js';
import { writeZip, type ZipEntry } from './zip.js';

/**
 * MVR (My Virtual Rig, DIN SPEC 15801, version 1.6).
 *
 * Archive: `GeneralSceneDescription.xml` plus one binary glTF per distinct geometry, all at the
 * root. Units: object `Matrix` values are millimetres in a right-handed, Z-up coordinate system
 * with the plan's x as X, the plan's y (away from the audience) as Y and the height above the
 * audience floor as Z. The glb files follow glTF: metres, +Y up, as `sceneMesh.ts` describes;
 * a reader converts Y-up to Z-up as it does for every glTF.
 */
export const MVR_VERSION = { major: 1, minor: 6 } as const;
export const MVR_ROOT_FILE = 'GeneralSceneDescription.xml';
export const MVR_PROVIDER = 'StageHarbour';

export type MvrMeta = {
  /** Seeds the layer UUIDs so a re-export of the same Bühnenbild keeps them. */
  sceneId?: string;
  providerVersion?: string;
  productionName?: string;
  venueName?: string;
  sceneName?: string;
  /** Timestamp for the archive entries and the `exportedAt` note. */
  now?: Date;
};

export const MVR_LAYER_NAMES = { venue: 'Spielstätte', scene: 'Bühnenbild' } as const;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function number(value: number): string {
  const text = (Math.abs(value) < 5e-7 ? 0 : value).toFixed(6);
  return text.replace(/\.?0+$/, '') || '0';
}

/** A stable, well-formed UUID for names that have no id of their own (the layers). */
export function derivedUuid(seed: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
    h3 = Math.imul(h3 ^ code, 2246822507);
    h4 = Math.imul(h4 ^ code, 3266489909);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** MVR `Matrix`: rotation about Z (degrees, counter-clockwise in the plan) and translation in mm. */
export function mvrMatrix(placement: SceneMeshEntry['placement']): string {
  const angle = placement.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const row = (x: number, y: number, z: number) => `{${number(x)},${number(y)},${number(z)}}`;
  return row(cos, sin, 0) + row(-sin, cos, 0) + row(0, 0, 1) + row(placement.x, placement.y, placement.elevation);
}

/** File name of each geometry inside the archive, in order of first use. */
export function mvrGeometryFiles(scene: SceneMesh): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of scene.entries) {
    if (!files.has(entry.geometryKey)) files.set(entry.geometryKey, `geo-${String(files.size + 1).padStart(3, '0')}.glb`);
  }
  return files;
}

function node(entry: SceneMeshEntry, file: string): string {
  const tag = entry.kind === 'truss' ? 'Truss' : 'SceneObject';
  return `          <${tag} uuid="${escapeXml(entry.id)}" name="${escapeXml(entry.name)}">\n`
    + `            <Matrix>${mvrMatrix(entry.placement)}</Matrix>\n`
    + `            <Geometries><Geometry3D fileName="${file}"/></Geometries>\n`
    + `          </${tag}>\n`;
}

export function buildMvrXml(scene: SceneMesh, meta: MvrMeta = {}, files = mvrGeometryFiles(scene)): string {
  const layer = (kind: SceneMeshEntry['layer']) => {
    const entries = scene.entries.filter(entry => entry.layer === kind);
    return `      <Layer uuid="${derivedUuid(`stageharbour:${meta.sceneId ?? 'scene'}:layer:${kind}`)}" name="${MVR_LAYER_NAMES[kind]}">\n`
      + `        <ChildList>\n${entries.map(entry => node(entry, files.get(entry.geometryKey)!)).join('')}        </ChildList>\n`
      + '      </Layer>\n';
  };
  const note = [
    ['production', meta.productionName], ['venue', meta.venueName], ['scene', meta.sceneName],
    ['exportedAt', (meta.now ?? new Date()).toISOString()],
  ].flatMap(([key, value]) => value ? [` ${key}="${escapeXml(value)}"`] : []).join('');
  const skipped = scene.skipped.map(item =>
    `        <Skipped uuid="${escapeXml(item.id)}" name="${escapeXml(item.name)}" reason="${escapeXml(item.reason)}"/>\n`).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<GeneralSceneDescription verMajor="${MVR_VERSION.major}" verMinor="${MVR_VERSION.minor}" provider="${MVR_PROVIDER}" providerVersion="${escapeXml(meta.providerVersion ?? 'dev')}">\n`
    + `  <UserData>\n    <Data provider="${MVR_PROVIDER}" ver="1">\n      <Source${note} units="mm" axes="X plan x, Y plan y, Z up"/>\n${skipped}    </Data>\n  </UserData>\n`
    + `  <Scene>\n    <Layers>\n${layer('venue')}${layer('scene')}    </Layers>\n  </Scene>\n`
    + '</GeneralSceneDescription>\n';
}

/** The MVR archive of a scene mesh: the description plus one glb per geometry. */
export async function exportMvr(scene: SceneMesh, meta: MvrMeta = {}): Promise<ArrayBuffer> {
  const files = mvrGeometryFiles(scene);
  const entries: ZipEntry[] = [{ name: MVR_ROOT_FILE, data: new TextEncoder().encode(buildMvrXml(scene, meta, files)) }];
  for (const [key, file] of files) {
    entries.push({ name: file, data: new Uint8Array(await exportObject3DGlb(sceneGeometryToObject3D(scene, key, file.replace(/\.glb$/, '')))) });
  }
  const bytes = await writeZip(entries, { modified: meta.now });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
