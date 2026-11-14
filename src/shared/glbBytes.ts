import { z } from 'zod';
import { MAX_MODEL_BYTES, MAX_MODEL_MB } from './assets.js';

const manifestSchema = z.object({
  asset: z.object({ version: z.literal('2.0') }),
  buffers: z.array(z.object({ uri: z.string().optional() })).optional(),
  images: z.array(z.object({ uri: z.string().optional() })).optional(),
});

/** Same embedded-GLB rules as the server, without Node's Buffer. */
export function validateGlbBytes(bytes: Uint8Array): void {
  if (bytes.length > MAX_MODEL_BYTES) throw new Error(`GLB exceeds ${MAX_MODEL_MB} MB`);
  if (bytes.length < 20) throw new Error('Invalid GLB header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number) => view.getUint32(offset, true);
  if (u32(0) !== 0x46546c67 || u32(4) !== 2 || u32(8) !== bytes.length) throw new Error('Invalid GLB header');
  let offset = 12;
  let manifest: z.infer<typeof manifestSchema> | undefined;
  const text = new TextDecoder();
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Incomplete GLB chunk');
    const length = u32(offset), type = u32(offset + 4);
    if (length % 4 || offset + 8 + length > bytes.length) throw new Error('Invalid GLB chunk');
    if (offset === 12) {
      if (type !== 0x4e4f534a) throw new Error('Missing GLB JSON');
      manifest = manifestSchema.parse(JSON.parse(text.decode(bytes.subarray(offset + 8, offset + 8 + length))));
    }
    offset += 8 + length;
  }
  if (!manifest) throw new Error('Missing GLB manifest');
  for (const resource of [...(manifest.buffers ?? []), ...(manifest.images ?? [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) throw new Error('GLB must embed its resources');
  }
}
