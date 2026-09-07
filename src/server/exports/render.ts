import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ConstructionSnapshot } from '../../shared/export.js';

export function renderOffThread(snapshot: ConstructionSnapshot) {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const typescript = import.meta.url.endsWith('.ts');
    const child = fork(fileURLToPath(new URL(typescript ? './worker.ts' : './worker.js', import.meta.url)), {
      execArgv: typescript ? ['--import', 'tsx'] : [],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); child.kill(); } };
    child.once('message', (value: Buffer | Uint8Array | { error: string }) => {
      if (value && typeof value === 'object' && 'error' in value) finish(() => reject(new Error(value.error)));
      else finish(() => resolve(Buffer.from(value as Uint8Array)));
    });
    child.once('error', error => finish(() => reject(error)));
    child.once('exit', code => { if (code) finish(() => reject(new Error(`PDF-Erzeugung beendet (${code}).`))); });
    child.send(snapshot);
  });
}
