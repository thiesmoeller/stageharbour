import { createHash, randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { germanDate, type ConstructionSnapshot } from '../../shared/export.js';
import {
  composeDocument, layoutManifest, PREVIEW_TTL_MS, type DocumentLayout, type ExportDocumentSpec, type FrozenScene,
} from '../../shared/exportDocument.js';
import type { ConstructionPackage } from '../../shared/package.js';
import type { Database } from '../db/connection.js';
import { exportPreparation } from '../db/schema.js';
import { createFontMeasure, renderDocument } from './documentPdf.js';
import type { FileStorage } from './storage.js';

export type IssuedDocument = {
  schemaVersion: 2;
  paper: ExportDocumentSpec['paper'];
  scale: ExportDocumentSpec['scale'];
  spec: ExportDocumentSpec;
  productionName: string;
  issuedAt: string;
  scenes: FrozenScene[];
  stock?: ConstructionPackage['stock'];
};

export function isIssuedDocument(value: unknown): value is IssuedDocument {
  return Boolean(value && typeof value === 'object' && (value as { schemaVersion?: number }).schemaVersion === 2
    && Array.isArray((value as IssuedDocument).scenes));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

export function sourceFingerprint(spec: ExportDocumentSpec, scenes: readonly { sceneId: string; revision: number; venueVersionId: string; layout: unknown; venue: unknown }[]) {
  // Sort object keys so Zod output order vs Postgres jsonb key order cannot flip the hash
  // (adding export layer fields made prepare vs issue serialization diverge).
  return createHash('sha256').update(stableStringify({
    spec,
    scenes: scenes.map(scene => ({
      sceneId: scene.sceneId, revision: scene.revision, venueVersionId: scene.venueVersionId,
      layout: scene.layout, venue: scene.venue,
    })),
  })).digest('hex');
}

const active = new Map<string, AbortController>();

export async function expirePreparations(db: Database, storage: FileStorage, now = new Date()) {
  const rows = await db.select().from(exportPreparation)
    .where(and(lt(exportPreparation.expiresAt, now), eq(exportPreparation.status, 'ready')));
  for (const row of rows) {
    if (row.storageKey) await storage.remove?.(row.storageKey);
    await db.update(exportPreparation).set({ status: 'expired', stage: 'expired', storageKey: null })
      .where(eq(exportPreparation.id, row.id));
  }
}

export function enqueuePreparation(
  db: Database, storage: FileStorage, id: string,
  renderImages?: (layout: DocumentLayout, frozen: IssuedDocument) => Promise<Map<string, Buffer>>,
) {
  const controller = new AbortController();
  active.set(id, controller);
  const timeout = setTimeout(() => controller.abort(), 120_000);
  void renderPreparation(db, storage, id, controller.signal, renderImages)
    .finally(() => { clearTimeout(timeout); active.delete(id); });
}

export function cancelPreparation(id: string) {
  active.get(id)?.abort();
}

async function renderPreparation(
  db: Database, storage: FileStorage, id: string, signal: AbortSignal,
  renderImages?: (layout: DocumentLayout, frozen: IssuedDocument) => Promise<Map<string, Buffer>>,
) {
  const started = Date.now();
  const [row] = await db.select().from(exportPreparation).where(eq(exportPreparation.id, id));
  if (!row || row.status === 'cancelled' || row.status === 'issued') return;
  const queueMs = started - row.queuedAt.getTime();
  await db.update(exportPreparation).set({ status: 'rendering', stage: 'rendering', startedAt: new Date() }).where(eq(exportPreparation.id, id));
  try {
    if (signal.aborted) throw new Error('cancelled');
    const frozen = row.frozen as IssuedDocument;
    const measure = createFontMeasure();
    const layout = composeDocument({
      spec: frozen.spec, scenes: frozen.scenes, productionName: frozen.productionName,
      issuedAtLabel: germanDate(frozen.issuedAt), stock: frozen.stock, measure,
    });
    const images = renderImages ? await renderImages(layout, frozen) : new Map<string, Buffer>();
    if (signal.aborted) throw new Error('cancelled');
    const pdf = await renderDocument(layout, images);
    const storageKey = `${row.workspaceId}/preparations/${row.id}.pdf`;
    await storage.put(storageKey, pdf);
    const renderMs = Date.now() - started;
    await db.update(exportPreparation).set({
      status: 'ready', stage: 'ready', storageKey, manifest: layoutManifest(layout), pageCount: layout.pageCount,
      finishedAt: new Date(), error: null, metrics: { queueMs, renderMs, pageCount: layout.pageCount },
    }).where(eq(exportPreparation.id, id));
  } catch (error) {
    const cancelled = signal.aborted || (error instanceof Error && error.message === 'cancelled');
    await db.update(exportPreparation).set({
      status: cancelled ? 'cancelled' : 'failed',
      stage: cancelled ? 'cancelled' : 'failed',
      error: cancelled ? 'Die Vorbereitung wurde abgebrochen.' : (error instanceof Error ? error.message : 'PDF-Erzeugung fehlgeschlagen.'),
      finishedAt: new Date(),
      metrics: { queueMs, renderMs: Date.now() - started, failed: true },
    }).where(and(eq(exportPreparation.id, id), eq(exportPreparation.status, 'rendering')));
  }
}

export async function renderIssuedDocument(frozen: IssuedDocument) {
  const measure = createFontMeasure();
  const layout = composeDocument({
    spec: frozen.spec, scenes: frozen.scenes, productionName: frozen.productionName,
    issuedAtLabel: germanDate(frozen.issuedAt), stock: frozen.stock, measure,
  });
  return renderDocument(layout);
}

export function newPreparationId() {
  return randomUUID();
}

export function preparationExpiry(now: Date) {
  return new Date(now.getTime() + PREVIEW_TTL_MS);
}

export type { ConstructionSnapshot };
