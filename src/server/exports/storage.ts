import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export type FileStorage = {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove?(key: string): Promise<void>;
};

export function localFilesystem(root: string): FileStorage {
  const base = resolve(root);
  function locate(key: string) {
    if (!key || key.split(/[/\\]/).some(part => !part || part === '..')) throw new Error('invalid storage key');
    const path = resolve(base, key);
    if (path !== base && !path.startsWith(base + sep)) throw new Error('invalid storage key');
    return path;
  }
  return {
    async put(key, bytes) {
      const path = locate(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    get(key) { return readFile(locate(key)); },
    async remove(key) {
      try { await unlink(locate(key)); } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      }
    },
  };
}
