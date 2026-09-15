import { z } from 'zod';
import { MAX_MODEL_BYTES, MAX_MODEL_MB } from '../../shared/assets.js';

export { MAX_MODEL_BYTES };
const manifestSchema = z.object({
  asset: z.object({ version: z.literal('2.0') }),
  buffers: z.array(z.object({ uri: z.string().optional() })).optional(),
  images: z.array(z.object({ uri: z.string().optional() })).optional(),
});

// Team uploads must travel as one file; external resource references would
// otherwise break when another member opens a layout on a different device.
export function validateGlb(bytes: Buffer): void {
  if (bytes.length > MAX_MODEL_BYTES) throw new Error(`GLB exceeds ${MAX_MODEL_MB} MB`);
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67
    || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB header');
  let offset = 12;
  let manifest: z.infer<typeof manifestSchema> | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Incomplete GLB chunk');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > bytes.length) throw new Error('Invalid GLB chunk');
    if (offset === 12) {
      if (type !== 0x4e4f534a) throw new Error('Missing GLB JSON');
      manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + length)));
    }
    offset += 8 + length;
  }
  if (!manifest) throw new Error('Missing GLB manifest');
  for (const resource of [...(manifest.buffers ?? []), ...(manifest.images ?? [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) throw new Error('GLB must embed its resources');
  }
}
