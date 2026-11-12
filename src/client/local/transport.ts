import { ApiError, type ApiTransport } from '../api.js';
import { documentDraftSchema } from '../../shared/exportDocument.js';
import {
  captureTemplateSchema,
  copySceneSchema,
  createSceneSchema,
  duplicateSceneSchema,
  instantiateTemplateSchema,
  layoutSchema,
  emptyLayout as createEmptyLayout,
  renameProductionSchema,
  renameSceneSchema,
  renameSceneTemplateSchema,
  saveLayoutSchema,
  saveVenueSchema,
  venueGeometrySchema,
  type Layout,
  type Scene,
} from '../../shared/layout.js';
import { ballastStockSchema, materialRequirements } from '../../shared/ballast.js';
import {
  createPanelSchema,
  sameGeometry,
  updatePanelSchema,
  upsertInventoryTypeSchema,
  type InventoryPanel,
} from '../../shared/inventory.js';
import { saveReportTemplatesSchema } from '../../shared/reportTemplate.js';
import {
  applyVenueVersion,
  captureTemplateLayout,
  copiedSceneName,
  copyLayoutIntoVenue,
  duplicateLayout,
} from '../../shared/scenes.js';
import { resolvedOverheadClearance } from '../../shared/overhead.js';
import { resolvedKeepClearWarnings } from '../../shared/keepClear.js';
import { wallTypeSchema, type WallElementType } from '../../shared/wall-types.js';
import { createLayoutPartIndex, resolveLayoutObjects } from '../../shared/layoutObjects.js';
import type { StockInventory } from '../../shared/partLists.js';
import { productionStockDemand, stockDemand, type DemandScene } from '../../shared/stockDemand.js';
import { isExchangeFormat } from '../../shared/exchange/formats.js';
import { STARTER_PART_IDS } from '../../shared/parts/starter/index.js';
import { createVenueSchema, publishVenueSchema, renameVenueSchema, venuePlanPreview } from '../../shared/venueLibrary.js';
import { boundsFromOutline } from '../../shared/venue.js';
import { z } from 'zod';
import { createPartsHandler, type PartsHandlerOptions } from './partsTransport.js';
import { match, pathOnly, queryOf } from './route.js';
import type { LocalScene, LocalSnapshot, LocalVenueVersion } from './snapshot.js';
import type { LocalStore } from './store.js';

function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}

function nextId(): string {
  return crypto.randomUUID();
}

function requireWorkspace(snapshot: LocalSnapshot, workspaceId: string): void {
  if (workspaceId !== snapshot.workspace.id) fail(404, 'Arbeitsbereich nicht verfügbar.');
}

function holder(snapshot: LocalSnapshot) {
  return { holderUserId: snapshot.user.id, holderName: snapshot.user.name };
}

function findVenueVersion(snapshot: LocalSnapshot, venueVersionId: string): LocalVenueVersion {
  const version = snapshot.venueVersions.find(row => row.id === venueVersionId);
  if (!version) fail(404, 'Spielstätte nicht verfügbar.');
  return version;
}

function findVenue(snapshot: LocalSnapshot, venueId: string) {
  const row = snapshot.venues.find(item => item.id === venueId);
  if (!row) fail(404, 'Spielstätte nicht verfügbar.');
  return row;
}

function latestVenueVersion(snapshot: LocalSnapshot, venueId: string): LocalVenueVersion {
  const versions = snapshot.venueVersions
    .filter(row => row.venueId === venueId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const latest = versions[0];
  if (!latest) fail(404, 'Spielstätte nicht verfügbar.');
  return latest;
}

function findProduction(snapshot: LocalSnapshot, productionId: string) {
  const row = snapshot.productions.find(item => item.id === productionId);
  if (!row) fail(404, 'Produktion nicht verfügbar.');
  return row;
}

function findScene(snapshot: LocalSnapshot, sceneId: string): LocalScene {
  const row = snapshot.scenes.find(item => item.id === sceneId);
  if (!row) fail(404, 'Bühnenbild nicht verfügbar.');
  return row;
}

function venueUpdateAvailable(snapshot: LocalSnapshot, scene: LocalScene): boolean {
  const pinned = findVenueVersion(snapshot, scene.venueVersionId);
  const latest = latestVenueVersion(snapshot, pinned.venueId);
  return latest.id !== pinned.id && latest.createdAt > pinned.createdAt;
}

function findInventoryPanel(snapshot: LocalSnapshot, panelId: string): InventoryPanel {
  const panel = snapshot.inventory.panels.find(item => item.id === panelId);
  if (!panel) fail(404, 'Platte nicht verfügbar.');
  return panel;
}

function ensureInventoryType(snapshot: LocalSnapshot, definition: WallElementType): WallElementType {
  const existing = snapshot.inventory.types.find(item => item.id === definition.id);
  if (!existing) {
    snapshot.inventory.types.push(definition);
    return definition;
  }
  if (!sameGeometry(existing, definition)) {
    fail(409, 'Dieser Wandtyp ist im Bestand bereits anders definiert.');
  }
  return existing;
}

const finishCompleteBodySchema = z.strictObject({
  sceneId: z.uuid(),
  wallId: z.uuid(),
  assignmentId: z.uuid(),
});

function toSceneRecord(snapshot: LocalSnapshot, scene: LocalScene): Scene {
  const production = findProduction(snapshot, scene.productionId);
  const version = findVenueVersion(snapshot, scene.venueVersionId);
  const venue = findVenue(snapshot, version.venueId);
  const geometry = venueGeometrySchema.parse(version.geometry);
  return {
    id: scene.id,
    name: scene.name,
    productionName: production.name,
    venueName: venue.name,
    productionId: production.id,
    venueId: venue.id,
    venueVersionId: version.id,
    venueUpdateAvailable: venueUpdateAvailable(snapshot, scene),
    lease: scene.lease,
    revision: scene.revision,
    venue: geometry,
    layout: scene.layout,
  };
}

function localPartIndex(snapshot: LocalSnapshot) {
  return createLayoutPartIndex({
    parts: snapshot.catalog.revisions.map(item => item.definition),
    materials: snapshot.catalog.materials,
  });
}

function localInventory(snapshot: LocalSnapshot): StockInventory {
  return {
    items: snapshot.catalog.stockItems.map(item => ({
      id: item.id, label: item.label, partId: item.partId, variantKey: item.variantKey,
      values: item.values, usable: item.usable, archived: item.archivedAt !== null,
    })),
    counts: snapshot.catalog.stockCounts.map(count => ({
      materialKey: count.materialKey, partId: count.partId, variantKey: count.variantKey, quantity: count.quantity,
    })),
  };
}

function demandScene(snapshot: LocalSnapshot, scene: LocalScene): DemandScene {
  const record = toSceneRecord(snapshot, scene);
  return {
    id: record.id, name: record.name, productionId: record.productionId, venueId: record.venueId,
    venueName: record.venueName, layout: record.layout, venue: record.venue,
  };
}

function toSceneSummary(snapshot: LocalSnapshot, scene: LocalScene) {
  const full = toSceneRecord(snapshot, scene);
  const layout = full.layout;
  const venue = full.venue;
  const partIndex = createLayoutPartIndex({
    parts: snapshot.catalog.revisions.map(item => item.definition),
    materials: snapshot.catalog.materials,
  });
  const objects = resolveLayoutObjects(layout, partIndex);
  const walls = objects.filter(item => item.object.part.id === STARTER_PART_IDS.wall);
  const platforms = objects.filter(item => [
    STARTER_PART_IDS.deck, STARTER_PART_IDS.floatingPlatform, STARTER_PART_IDS.solidPlatform,
  ].includes(item.object.part.id));
  return {
    id: full.id,
    name: full.name,
    productionName: full.productionName,
    venueName: full.venueName,
    productionId: full.productionId,
    venueId: full.venueId,
    venueVersionId: full.venueVersionId,
    venueUpdateAvailable: full.venueUpdateAvailable,
    lease: full.lease,
    preview: {
      width: venue.width,
      depth: venue.depth,
      walls: walls.map(item => ({ corners: item.footprint })),
      platforms: [
        ...(venue.platforms ?? []).map(platform => ({ outline: platform.outline })),
        ...platforms.map(item => ({ outline: item.footprint })),
      ],
    },
  };
}

function toVenueRecord(snapshot: LocalSnapshot, venueId: string, versionId?: string) {
  const venue = findVenue(snapshot, venueId);
  const version = versionId
    ? (() => {
      const row = snapshot.venueVersions.find(item => item.id === versionId && item.venueId === venueId);
      if (!row) fail(404, 'Spielstätte nicht verfügbar.');
      return row;
    })()
    : latestVenueVersion(snapshot, venueId);
  const geometry = venueGeometrySchema.parse(version.geometry);
  return {
    id: venue.id,
    name: venue.name,
    venueVersionId: version.id,
    width: geometry.width,
    depth: geometry.depth,
    venue: geometry,
    preview: venuePlanPreview(geometry),
  };
}

function emptyLayout(): Layout {
  return createEmptyLayout();
}

export function createLocalTransport(store: LocalStore, options: PartsHandlerOptions = {}): ApiTransport {
  let signedIn = true;
  const handleParts = createPartsHandler(store, options);

  async function handle(pathRaw: string, body?: unknown, methodRaw?: string): Promise<unknown> {
    const path = pathOnly(pathRaw);
    const method = (methodRaw ?? (body !== undefined ? 'POST' : 'GET')).toUpperCase();

    if (path === '/api/me' && method === 'GET') {
      if (!signedIn) fail(401, 'Nicht angemeldet.');
      const snapshot = store.getSnapshot();
      return { user: snapshot.user, workspace: snapshot.workspace };
    }
    if (path === '/api/branding' && method === 'GET') {
      return store.getSnapshot().branding;
    }
    if (path === '/api/login-options' && method === 'GET') {
      return { oidc: false, version: 'local' };
    }
    if (path === '/api/auth/sign-in/email' && method === 'POST') {
      signedIn = true;
      return {};
    }
    if (path === '/api/auth/sign-out' && method === 'POST') {
      signedIn = false;
      return {};
    }

    const parts = await handleParts({ path, method, query: queryOf(pathRaw), body });
    if (parts) return parts.value;

    let params = match(path, '/api/workspaces/:workspaceId/scenes');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return snapshot.scenes
        .map(scene => toSceneSummary(snapshot, scene))
        .sort((a, b) => a.productionName.localeCompare(b.productionName, 'de') || a.name.localeCompare(b.name, 'de'));
    }
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const input = createSceneSchema.parse(body);
      const sceneId = nextId();
      let createdProductionId = '';
      let createdVenueVersionId = '';
      let createdSceneName = '';
      await store.mutate(draft => {
        if ('productionId' in input) {
          findProduction(draft, input.productionId);
          findVenueVersion(draft, input.venueVersionId);
          createdProductionId = input.productionId;
          createdVenueVersionId = input.venueVersionId;
          createdSceneName = input.sceneName;
        } else if ('venueVersionId' in input) {
          findVenueVersion(draft, input.venueVersionId);
          createdProductionId = nextId();
          createdVenueVersionId = input.venueVersionId;
          createdSceneName = input.sceneName;
          draft.productions.push({ id: createdProductionId, name: input.productionName });
        } else {
          const venueId = nextId();
          createdVenueVersionId = nextId();
          createdProductionId = nextId();
          createdSceneName = input.sceneName;
          draft.venues.push({ id: venueId, name: input.venueName });
          draft.venueVersions.push({
            id: createdVenueVersionId,
            venueId,
            createdAt: new Date().toISOString(),
            geometry: { schemaVersion: 1, width: input.width, depth: input.depth },
          });
          draft.productions.push({ id: createdProductionId, name: input.productionName });
        }
        draft.scenes.push({
          id: sceneId,
          name: createdSceneName,
          productionId: createdProductionId,
          venueVersionId: createdVenueVersionId,
          revision: 0,
          lease: null,
          layout: emptyLayout(),
        });
      });
      return toSceneRecord(store.getSnapshot(), findScene(store.getSnapshot(), sceneId));
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return toSceneRecord(snapshot, findScene(snapshot, params.sceneId!));
    }
    if (params && method === 'PATCH') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const { name } = renameSceneSchema.parse(body);
      findScene(snapshot, params.sceneId!);
      await store.mutate(draft => {
        findScene(draft, params!.sceneId!).name = name;
      });
      return toSceneRecord(store.getSnapshot(), findScene(store.getSnapshot(), params.sceneId!));
    }
    if (params && method === 'DELETE') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findScene(snapshot, params.sceneId!);
      await store.mutate(draft => {
        draft.scenes = draft.scenes.filter(item => item.id !== params!.sceneId);
      });
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/duplicate');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findScene(snapshot, params.sceneId!);
      const input = duplicateSceneSchema.parse(body ?? {});
      const copyId = nextId();
      await store.mutate(draft => {
        const source = findScene(draft, params!.sceneId!);
        draft.scenes.push({
          id: copyId,
          name: input.sceneName ?? copiedSceneName(source.name),
          productionId: source.productionId,
          venueVersionId: source.venueVersionId,
          revision: 0,
          lease: null,
          layout: duplicateLayout(source.layout, nextId),
        });
      });
      return toSceneRecord(store.getSnapshot(), findScene(store.getSnapshot(), copyId));
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/copy');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findScene(snapshot, params.sceneId!);
      const input = copySceneSchema.parse(body);
      findProduction(snapshot, input.productionId);
      const destVersion = findVenueVersion(snapshot, input.venueVersionId);
      const copyId = nextId();
      await store.mutate(draft => {
        const source = findScene(draft, params!.sceneId!);
        draft.scenes.push({
          id: copyId,
          name: input.sceneName ?? copiedSceneName(source.name),
          productionId: input.productionId,
          venueVersionId: destVersion.id,
          revision: 0,
          lease: null,
          layout: copyLayoutIntoVenue(
            source.layout,
            venueGeometrySchema.parse(destVersion.geometry),
            input.surfaceMap ?? {},
            nextId,
          ).layout,
        });
      });
      return toSceneRecord(store.getSnapshot(), findScene(store.getSnapshot(), copyId));
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/templates');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const existing = findScene(snapshot, params.sceneId!);
      const input = captureTemplateSchema.parse(body);
      const version = findVenueVersion(snapshot, existing.venueVersionId);
      const geometry = venueGeometrySchema.parse(version.geometry);
      const id = nextId();
      const layout = captureTemplateLayout(existing.layout);
      const sourceSurfaces = (geometry.platforms ?? []).map(platform => ({ id: platform.id, label: platform.label }));
      const record = { id, name: input.name, layout, sourceSurfaces };
      await store.mutate(draft => {
        draft.sceneTemplates.push(record);
      });
      return record;
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/layout');
    if (params && method === 'PUT') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const input = saveLayoutSchema.parse(body);
      const scene = findScene(snapshot, params.sceneId!);
      if (scene.revision !== input.revision) {
        fail(409, 'Das Bühnenbild wurde inzwischen geändert. Ihre lokalen Änderungen bleiben erhalten.');
      }
      const version = findVenueVersion(snapshot, scene.venueVersionId);
      const venue = venueGeometrySchema.parse(version.geometry);
      const layout = layoutSchema.parse(input.layout);
      const revision = scene.revision + 1;
      await store.mutate(draft => {
        const row = findScene(draft, params!.sceneId!);
        row.layout = layout;
        row.revision = revision;
      });
      const partIndex = createLayoutPartIndex({
        parts: snapshot.catalog.revisions.map(item => item.definition),
        materials: snapshot.catalog.materials,
      });
      const objects = resolveLayoutObjects(layout, partIndex);
      return {
        revision,
        warnings: [...resolvedOverheadClearance(objects, venue), ...resolvedKeepClearWarnings(venue, objects)],
      };
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/lease');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findScene(snapshot, params.sceneId!);
      const lease = holder(snapshot);
      await store.mutate(draft => {
        findScene(draft, params!.sceneId!).lease = lease;
      });
      return lease;
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/lease/heartbeat');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findScene(snapshot, params.sceneId!);
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/lease/release');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findScene(snapshot, params.sceneId!);
      await store.mutate(draft => {
        findScene(draft, params!.sceneId!).lease = null;
      });
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/recover');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findScene(snapshot, params.sceneId!);
      const payload = body as { name?: unknown; layout?: unknown; sourceSurfaces?: unknown };
      if (typeof payload?.name !== 'string' || !payload.name.trim()) fail(400, 'Name erforderlich.');
      const layout = captureTemplateLayout(layoutSchema.parse(payload.layout));
      const sourceSurfaces = Array.isArray(payload.sourceSurfaces)
        ? payload.sourceSurfaces.map(item => {
          const row = item as { id?: unknown; label?: unknown };
          return {
            id: typeof row.id === 'string' ? row.id : nextId(),
            label: typeof row.label === 'string' ? row.label : 'Fläche',
          };
        })
        : [];
      const id = nextId();
      const record = { id, name: payload.name.trim(), layout, sourceSurfaces };
      await store.mutate(draft => {
        draft.sceneTemplates.push(record);
      });
      return record;
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/venue');
    if (params && method === 'PUT') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const scene = findScene(snapshot, params.sceneId!);
      const pinned = findVenueVersion(snapshot, scene.venueVersionId);
      const input = saveVenueSchema.parse(body).venue;
      const geometry = input.outline ? { ...input, ...boundsFromOutline(input.outline) } : input;
      const nextVersionId = nextId();
      const adapted = applyVenueVersion(scene.layout, geometry);
      const revision = scene.revision + 1;
      await store.mutate(draft => {
        draft.venueVersions.push({
          id: nextVersionId,
          venueId: pinned.venueId,
          createdAt: new Date().toISOString(),
          geometry,
        });
        const row = findScene(draft, params!.sceneId!);
        row.venueVersionId = nextVersionId;
        row.layout = adapted.layout;
        row.revision = revision;
      });
      return { venue: geometry, venueVersionId: nextVersionId, layout: adapted.layout, revision };
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/venue-apply');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const scene = findScene(snapshot, params.sceneId!);
      const pinned = findVenueVersion(snapshot, scene.venueVersionId);
      const latest = latestVenueVersion(snapshot, pinned.venueId);
      let working = scene;
      if (latest.id !== pinned.id) {
        const diagnostics = applyVenueVersion(scene.layout, venueGeometrySchema.parse(latest.geometry));
        const revision = scene.revision + 1;
        await store.mutate(draft => {
          const row = findScene(draft, params!.sceneId!);
          row.venueVersionId = latest.id;
          row.layout = diagnostics.layout;
          row.revision = revision;
        });
        working = findScene(store.getSnapshot(), params.sceneId!);
      }
      const record = toSceneRecord(store.getSnapshot(), working);
      const diagnostics = applyVenueVersion(record.layout, record.venue);
      return {
        ...record,
        unresolvedSupport: diagnostics.unresolvedSupport,
        warnings: diagnostics.warnings,
        unresolvedWarnings: diagnostics.unresolvedWarnings,
      };
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/venue/report-templates');
    if (params && method === 'PATCH') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const scene = findScene(snapshot, params.sceneId!);
      const pinned = findVenueVersion(snapshot, scene.venueVersionId);
      const latest = latestVenueVersion(snapshot, pinned.venueId);
      if (latest.id !== pinned.id) {
        fail(409, 'Eine neuere Spielstättenfassung ist vorhanden. Bitte übernehmen Sie diese ausdrücklich im Bühnenbild, bevor Sie eine Blattvorlage speichern.');
      }
      const input = saveReportTemplatesSchema.parse(body);
      if (input.venueVersionId && input.venueVersionId !== pinned.id) {
        fail(409, 'Die Blattvorlagen wurden inzwischen geändert. Bitte laden Sie das Bühnenbild neu.');
      }
      const templates = new Map((latest.geometry.reportTemplates ?? []).map(template => [template.id, template]));
      for (const template of input.reportTemplates) templates.set(template.id, template);
      const geometry = venueGeometrySchema.parse({
        ...latest.geometry,
        reportTemplates: [...templates.values()],
      });
      const nextVersionId = nextId();
      const adapted = applyVenueVersion(scene.layout, geometry);
      const revision = scene.revision + 1;
      await store.mutate(draft => {
        draft.venueVersions.push({
          id: nextVersionId,
          venueId: pinned.venueId,
          createdAt: new Date().toISOString(),
          geometry,
        });
        const row = findScene(draft, params!.sceneId!);
        row.venueVersionId = nextVersionId;
        row.layout = adapted.layout;
        row.revision = revision;
      });
      return { venue: geometry, venueVersionId: nextVersionId, layout: adapted.layout, revision };
    }

    params = match(path, '/api/workspaces/:workspaceId/scene-templates');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return snapshot.sceneTemplates.map(({ id, name }) => ({ id, name }));
    }

    params = match(path, '/api/workspaces/:workspaceId/scene-templates/:templateId');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const record = snapshot.sceneTemplates.find(item => item.id === params!.templateId);
      if (!record) fail(404, 'Bühnenbildvorlage nicht verfügbar.');
      return record;
    }
    if (params && method === 'PATCH') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const { name } = renameSceneTemplateSchema.parse(body);
      if (!snapshot.sceneTemplates.some(item => item.id === params!.templateId)) {
        fail(404, 'Bühnenbildvorlage nicht verfügbar.');
      }
      await store.mutate(draft => {
        const row = draft.sceneTemplates.find(item => item.id === params!.templateId);
        if (!row) fail(404, 'Bühnenbildvorlage nicht verfügbar.');
        row.name = name;
      });
      return { id: params.templateId, name };
    }
    if (params && method === 'DELETE') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      if (!snapshot.sceneTemplates.some(item => item.id === params!.templateId)) {
        fail(404, 'Bühnenbildvorlage nicht verfügbar.');
      }
      await store.mutate(draft => {
        draft.sceneTemplates = draft.sceneTemplates.filter(item => item.id !== params!.templateId);
      });
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/scene-templates/:templateId/instantiate');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const template = snapshot.sceneTemplates.find(item => item.id === params!.templateId);
      if (!template) fail(404, 'Bühnenbildvorlage nicht verfügbar.');
      const input = instantiateTemplateSchema.parse(body);
      findProduction(snapshot, input.productionId);
      const destVersion = findVenueVersion(snapshot, input.venueVersionId);
      const copyId = nextId();
      await store.mutate(draft => {
        const source = draft.sceneTemplates.find(item => item.id === params!.templateId);
        if (!source) fail(404, 'Bühnenbildvorlage nicht verfügbar.');
        draft.scenes.push({
          id: copyId,
          name: input.sceneName ?? source.name,
          productionId: input.productionId,
          venueVersionId: destVersion.id,
          revision: 0,
          lease: null,
          layout: copyLayoutIntoVenue(
            source.layout,
            venueGeometrySchema.parse(destVersion.geometry),
            input.surfaceMap ?? {},
            nextId,
          ).layout,
        });
      });
      return toSceneRecord(store.getSnapshot(), findScene(store.getSnapshot(), copyId));
    }

    params = match(path, '/api/workspaces/:workspaceId/venues');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return snapshot.venues
        .map(venue => {
          const record = toVenueRecord(snapshot, venue.id);
          return {
            id: record.id,
            name: record.name,
            venueVersionId: record.venueVersionId,
            width: record.width,
            depth: record.depth,
            preview: record.preview,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    }
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const input = createVenueSchema.parse(body);
      const id = nextId();
      const versionId = nextId();
      await store.mutate(draft => {
        draft.venues.push({ id, name: input.name });
        draft.venueVersions.push({
          id: versionId,
          venueId: id,
          createdAt: new Date().toISOString(),
          geometry: { schemaVersion: 1, width: input.width, depth: input.depth },
        });
      });
      return toVenueRecord(store.getSnapshot(), id);
    }

    params = match(path, '/api/workspaces/:workspaceId/venues/:venueId');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return toVenueRecord(snapshot, params.venueId!);
    }
    if (params && method === 'PATCH') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const { name } = renameVenueSchema.parse(body);
      findVenue(snapshot, params.venueId!);
      await store.mutate(draft => {
        findVenue(draft, params!.venueId!).name = name;
      });
      return toVenueRecord(store.getSnapshot(), params.venueId!);
    }
    if (params && method === 'PUT') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findVenue(snapshot, params.venueId!);
      const input = publishVenueSchema.parse(body);
      const latest = latestVenueVersion(snapshot, params.venueId!);
      if (latest.id !== input.venueVersionId) {
        fail(409, 'Eine neuere Spielstättenfassung ist vorhanden. Bitte sichern Sie Ihren Entwurf und laden Sie die Spielstätte neu.');
      }
      const geometry = input.venue.outline
        ? { ...input.venue, ...boundsFromOutline(input.venue.outline) }
        : input.venue;
      await store.mutate(draft => {
        draft.venueVersions.push({
          id: nextId(),
          venueId: params!.venueId!,
          createdAt: new Date().toISOString(),
          geometry,
        });
      });
      return toVenueRecord(store.getSnapshot(), params.venueId!);
    }
    if (params && method === 'DELETE') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findVenue(snapshot, params.venueId!);
      const versionIds = new Set(
        snapshot.venueVersions.filter(row => row.venueId === params!.venueId).map(row => row.id),
      );
      if (snapshot.scenes.some(scene => versionIds.has(scene.venueVersionId))) {
        fail(409, 'Diese Spielstätte wird noch von Produktionen verwendet. Löschen Sie zuerst die zugehörigen Bühnenbilder.');
      }
      await store.mutate(draft => {
        draft.venueVersions = draft.venueVersions.filter(row => row.venueId !== params!.venueId);
        draft.venues = draft.venues.filter(row => row.id !== params!.venueId);
      });
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/productions/:productionId/venues/:venueId/requirements');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findProduction(snapshot, params.productionId!);
      findVenue(snapshot, params.venueId!);
      const layouts = snapshot.scenes
        .filter(scene => {
          if (scene.productionId !== params!.productionId) return false;
          const version = snapshot.venueVersions.find(row => row.id === scene.venueVersionId);
          return version?.venueId === params!.venueId;
        })
        .map(scene => scene.layout);
      if (!layouts.length) fail(404, 'Produktion an dieser Spielstätte nicht verfügbar.');
      return materialRequirements(layouts, snapshot.inventory.ballast);
    }

    params = match(path, '/api/workspaces/:workspaceId/scenes/:sceneId/stock-demand');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const scene = snapshot.scenes.find(row => row.id === params!.sceneId) ?? fail(404, 'Bühnenbild nicht verfügbar.');
      return stockDemand([demandScene(snapshot, scene)], localPartIndex(snapshot), localInventory(snapshot));
    }

    params = match(path, '/api/workspaces/:workspaceId/productions/:productionId/venues/:venueId/stock-demand');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findProduction(snapshot, params.productionId!);
      findVenue(snapshot, params.venueId!);
      const scenes = snapshot.scenes.filter(row => row.productionId === params!.productionId)
        .map(row => demandScene(snapshot, row)).filter(row => row.venueId === params!.venueId);
      if (!scenes.length) fail(404, 'Produktion an dieser Spielstätte nicht verfügbar.');
      return stockDemand(scenes, localPartIndex(snapshot), localInventory(snapshot));
    }

    params = match(path, '/api/workspaces/:workspaceId/productions/:productionId/stock-demand');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findProduction(snapshot, params.productionId!);
      const scenes = snapshot.scenes.filter(row => row.productionId === params!.productionId).map(row => demandScene(snapshot, row));
      if (!scenes.length) fail(404, 'Produktion nicht verfügbar.');
      return productionStockDemand(scenes, localPartIndex(snapshot), localInventory(snapshot));
    }

    params = match(path, '/api/workspaces/:workspaceId/venues/:venueId/versions/:venueVersionId');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return toVenueRecord(snapshot, params.venueId!, params.venueVersionId!);
    }

    params = match(path, '/api/workspaces/:workspaceId/venues/:venueId/lease');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findVenue(snapshot, params.venueId!);
      return holder(snapshot);
    }
    params = match(path, '/api/workspaces/:workspaceId/venues/:venueId/lease/heartbeat');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findVenue(snapshot, params.venueId!);
      return { ok: true as const };
    }
    params = match(path, '/api/workspaces/:workspaceId/venues/:venueId/lease/release');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findVenue(snapshot, params.venueId!);
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return { ...snapshot.inventory, lease: snapshot.inventory.lease };
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory/lease');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const lease = holder(snapshot);
      await store.mutate(draft => {
        draft.inventory.lease = lease;
      });
      return lease;
    }
    params = match(path, '/api/workspaces/:workspaceId/inventory/lease/heartbeat');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return { ok: true as const };
    }
    params = match(path, '/api/workspaces/:workspaceId/inventory/lease/release');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      await store.mutate(draft => {
        draft.inventory.lease = null;
      });
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory/ballast');
    if (params && method === 'PUT') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const ballast = ballastStockSchema.parse(body);
      await store.mutate(draft => {
        draft.inventory.ballast = ballast;
      });
      return ballast;
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory/finish-work');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      return [];
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory/types');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const definition = upsertInventoryTypeSchema.parse(body);
      if (snapshot.inventory.types.some(item => item.id === definition.id)) {
        fail(409, 'Dieser Wandtyp ist im Bestand bereits angelegt.');
      }
      await store.mutate(draft => {
        draft.inventory.types.push(definition);
      });
      return definition;
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory/types/:typeId');
    if (params && method === 'PUT') {
      const typeId = params.typeId!;
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const definition = upsertInventoryTypeSchema.parse(body);
      if (definition.id !== typeId) fail(400, 'Wandtyp-ID stimmt nicht überein.');
      const existing = snapshot.inventory.types.find(item => item.id === typeId);
      if (!existing) fail(404, 'Wandtyp nicht verfügbar.');
      const inUse = snapshot.inventory.panels.some(item => item.typeId === typeId);
      if (inUse && !sameGeometry(existing, definition)) {
        fail(409, 'Dieser Wandtyp ist im Bestand bereits anders definiert.');
      }
      await store.mutate(draft => {
        const index = draft.inventory.types.findIndex(item => item.id === typeId);
        if (index < 0) fail(404, 'Wandtyp nicht verfügbar.');
        draft.inventory.types[index] = definition;
        for (const panel of draft.inventory.panels) {
          if (panel.typeId === typeId) panel.type = definition;
        }
      });
      return definition;
    }
    if (params && method === 'DELETE') {
      const typeId = params.typeId!;
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      if (!snapshot.inventory.types.some(item => item.id === typeId)) {
        fail(404, 'Wandtyp nicht verfügbar.');
      }
      if (snapshot.inventory.panels.some(item => item.typeId === typeId)) {
        fail(409, 'Dieser Wandtyp wird noch von Platten verwendet.');
      }
      await store.mutate(draft => {
        draft.inventory.types = draft.inventory.types.filter(item => item.id !== typeId);
      });
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory/panels');
    if (params && method === 'POST') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const input = createPanelSchema.parse(body);
      if (snapshot.inventory.panels.some(item => item.label === input.label)) {
        fail(409, 'Dieses Plattenetikett ist bereits vergeben.');
      }
      const id = nextId();
      const available = input.available ?? true;
      const note = input.note ?? null;
      let created: InventoryPanel | undefined;
      await store.mutate(draft => {
        const type = ensureInventoryType(draft, input.type);
        created = { id, label: input.label, typeId: type.id, available, note, type };
        draft.inventory.panels.push(created);
      });
      return created!;
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory/panels/:panelId/finish-complete');
    if (params && method === 'POST') {
      const panelId = params.panelId!;
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const input = finishCompleteBodySchema.parse(body);
      findScene(snapshot, input.sceneId);
      findInventoryPanel(snapshot, panelId);
      fail(410, 'Oberflächenarbeiten werden jetzt am Bestandsstück des Bauteils dokumentiert.');
    }

    params = match(path, '/api/workspaces/:workspaceId/inventory/panels/:panelId');
    if (params && method === 'PATCH') {
      const panelId = params.panelId!;
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const input = updatePanelSchema.parse(body);
      const existing = findInventoryPanel(snapshot, panelId);
      if (input.label !== undefined && input.label !== existing.label
        && snapshot.inventory.panels.some(item => item.label === input.label)) {
        fail(409, 'Dieses Plattenetikett ist bereits vergeben.');
      }
      if (input.cutouts) {
        if (!wallTypeSchema.safeParse({ ...existing.type, openings: [...existing.type.openings, ...input.cutouts] }).success) {
          fail(400, 'Ausschnitte müssen innerhalb der Platte liegen und eindeutige IDs haben (höchstens 20 Öffnungen).');
        }
      }
      let updated: InventoryPanel | undefined;
      await store.mutate(draft => {
        const panel = findInventoryPanel(draft, panelId);
        if (input.label !== undefined) panel.label = input.label;
        if (input.available !== undefined) panel.available = input.available;
        if (input.note !== undefined) panel.note = input.note;
        if (input.cutouts !== undefined) panel.cutouts = input.cutouts;
        if (input.finish) {
          panel.currentFinish = { ...input.finish, confirmedAt: new Date().toISOString() };
        }
        updated = panel;
      });
      return updated!;
    }
    if (params && method === 'DELETE') {
      const panelId = params.panelId!;
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findInventoryPanel(snapshot, panelId);
      const used = snapshot.scenes.filter(record => record.layout.objects.some(object => object.stockItemId === panelId));
      if (used.length) {
        fail(409, `Platte ist noch zugewiesen: ${used.map(record => record.name).join(', ')}. Zuweisungen zuerst in den Bühnenbildern lösen.`);
      }
      await store.mutate(draft => {
        draft.inventory.panels = draft.inventory.panels.filter(item => item.id !== panelId);
      });
      return { ok: true as const };
    }

    params = match(path, '/api/workspaces/:workspaceId/assets');
    if (params && method === 'GET') {
      requireWorkspace(store.getSnapshot(), params.workspaceId!);
      return [];
    }

    params = match(path, '/api/workspaces/:workspaceId/surfaces');
    if (params && method === 'GET') {
      requireWorkspace(store.getSnapshot(), params.workspaceId!);
      return [];
    }

    params = match(path, '/api/workspaces/:workspaceId/productions/:productionId');
    if (params && method === 'PATCH') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      const { name } = renameProductionSchema.parse(body);
      findProduction(snapshot, params.productionId!);
      await store.mutate(draft => {
        findProduction(draft, params!.productionId!).name = name;
      });
      return { id: params.productionId, name };
    }

    params = match(path, '/api/workspaces/:workspaceId/productions/:productionId/document-draft');
    if (params && method === 'GET') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findProduction(snapshot, params.productionId!);
      return snapshot.documentDrafts[params.productionId!] ?? null;
    }
    if (params && method === 'PUT') {
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      findProduction(snapshot, params.productionId!);
      const draft = documentDraftSchema.parse(body);
      await store.mutate(next => {
        next.documentDrafts[params!.productionId!] = draft;
      });
      return draft;
    }

    fail(501, `Dieser Endpunkt ist im lokalen Demo-Modus nicht verfügbar (${method} ${path}).`);
  }

  return {
    async request(path, body?, method?) {
      return handle(path, body, method);
    },
    async upload() {
      fail(501, 'Uploads sind im lokalen Demo-Modus nicht verfügbar.');
    },
    async getBlob(path) {
      const params = match(pathOnly(path), '/api/workspaces/:workspaceId/scenes/:sceneId/export/:format');
      if (!params) fail(501, 'PDF- und Dateiabrufe sind im lokalen Demo-Modus nicht verfügbar.');
      const snapshot = store.getSnapshot();
      requireWorkspace(snapshot, params.workspaceId!);
      if (!isExchangeFormat(params.format!)) fail(404, 'Dieses Austauschformat gibt es nicht.');
      const record = toSceneRecord(snapshot, findScene(snapshot, params.sceneId!));
      const { exportSceneFile } = await import('../../shared/exchange/index.js');
      const file = await exportSceneFile({
        format: params.format, scene: record, venue: record.venue, layout: record.layout,
        catalog: createLayoutPartIndex({
          parts: snapshot.catalog.revisions.map(item => item.definition),
          materials: snapshot.catalog.materials,
        }),
        providerVersion: 'lokal',
      });
      return new Blob([file.data], { type: file.contentType });
    },
  };
}
