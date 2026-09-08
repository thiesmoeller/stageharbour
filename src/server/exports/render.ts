import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ConstructionSnapshot } from '../../shared/export.js';
import type { ConstructionPackage } from '../../shared/package.js';

type WorkerResult = { pdf: string } | { error: string };

function pdfFromMessage(value: unknown): Buffer {
  if (value && typeof value === 'object' && 'error' in value && typeof (value as { error: unknown }).error === 'string') {
    throw new Error((value as { error: string }).error);
  }
  if (value && typeof value === 'object' && 'pdf' in value && typeof (value as { pdf: unknown }).pdf === 'string') {
    return Buffer.from((value as { pdf: string }).pdf, 'base64');
  }
  // Legacy IPC shapes (advanced serialization / older workers).
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (
    value && typeof value === 'object'
    && (value as { type?: unknown }).type === 'Buffer'
    && Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  throw new Error('PDF-Erzeugung lieferte keine Binärdaten.');
}

export function renderOffThread(snapshot: ConstructionSnapshot | ConstructionPackage) {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const typescript = import.meta.url.endsWith('.ts');
    const child = fork(fileURLToPath(new URL(typescript ? './worker.ts' : './worker.js', import.meta.url)), {
      execArgv: typescript ? ['--import', 'tsx'] : [],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); child.kill(); } };
    child.once('message', (value: WorkerResult | Buffer | Uint8Array) => {
      try {
        const pdf = pdfFromMessage(value);
        finish(() => resolve(pdf));
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error('PDF-Erzeugung fehlgeschlagen.')));
      }
    });
    child.once('error', error => finish(() => reject(error)));
    child.once('exit', code => { if (code) finish(() => reject(new Error(`PDF-Erzeugung beendet (${code}).`))); });
    child.send(snapshot);
  });
}
