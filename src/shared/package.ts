import { ballastSchema, materialRequirementsSchema, materialRequirements, sceneMaterials, materialCountsSchema, EMPTY_BALLAST_STOCK, type BallastStock } from './ballast.js';
import { z } from 'zod';
import { freezeExportSchema, freezeSnapshot, constructionSnapshotSchema, DRAWING_SCALE, paperSizeSchema, type ConstructionSnapshot } from './export.js';
import type { ExportLayers } from './exportLayers.js';
import { inventoryPanelSchema, inventoryWarnings, type InventoryPanel } from './inventory.js';
import { keepClearWarningSchema } from './keepClear.js';
import type { Scene } from './layout.js';
import { overheadWarningsSchema } from './overhead.js';
import type { DrawingScale, PaperSize } from './tiling.js';

const name = z.string().trim().min(1).max(120);
const note = z.string().trim().max(500);

export const freezePackageSchema = freezeExportSchema.extend({
  sceneIds: z.array(z.uuid()).min(1).max(250),
}).refine(body => new Set(body.sceneIds).size === body.sceneIds.length, 'Scene IDs must be unique');
export const inventoryWarningSchema = z.strictObject({
  kind: z.enum(['unassigned', 'unavailable', 'duplicate', 'incompatible', 'shortage']),
  wallId: z.uuid().optional(), panelId: z.uuid().optional(), message: z.string().min(1).max(500),
});
const wallPartSchema = z.strictObject({
  wallId: z.uuid(), label: name, assemblyNumber: z.number().int().positive().max(250).optional(),
  panelId: z.uuid().optional(), panelLabel: name.optional(),
  width: z.number().finite(), height: z.number().finite(), thickness: z.number().finite(),
  x: z.number().finite(), y: z.number().finite(), rotation: z.number().finite(),
});
const bracePartSchema = z.strictObject({
  ballast: ballastSchema.optional(),
  id: z.uuid(), label: name,
  footprintWidth: z.number().finite(), footprintDepth: z.number().finite(), height: z.number().finite(),
});
export const scenePartsListSchema = z.strictObject({
  sceneId: z.uuid(), sceneName: name,
  materials: materialCountsSchema.optional(),
  walls: z.array(wallPartSchema).max(250),
  braces: z.array(bracePartSchema).max(250),
  inventoryWarnings: z.array(inventoryWarningSchema).max(500),
  overheadWarnings: overheadWarningsSchema,
  keepClearWarnings: z.array(keepClearWarningSchema).max(500),
  riggingNotes: z.string().max(2000).optional(),
});
export const stockPanelSchema = z.strictObject({
  panelId: z.uuid(), label: name, available: z.boolean(), note: note.nullable(),
  appearances: z.number().int().positive(), sceneNames: z.array(name).min(1).max(250),
});
export const stockUnassignedSchema = z.strictObject({
  sceneId: z.uuid(), sceneName: name, wallId: z.uuid(), wallLabel: name,
});
export const stockUnavailableSchema = z.strictObject({
  sceneId: z.uuid(), sceneName: name, wallId: z.uuid(), wallLabel: name, panelId: z.uuid(), panelLabel: name,
});
export const packageStockSchema = z.strictObject({
  venueMaterials: z.array(materialRequirementsSchema.extend({ venueId: z.uuid(), venueName: name })).optional(),
  physicalPanels: z.number().int().nonnegative(),
  appearances: z.number().int().nonnegative(),
  panels: z.array(stockPanelSchema).max(500),
  unassigned: z.array(stockUnassignedSchema).max(500),
  unavailable: z.array(stockUnavailableSchema).max(500),
  conflicts: z.array(inventoryWarningSchema.extend({ sceneName: name }).omit({ kind: true }).extend({
    kind: z.enum(['duplicate', 'incompatible']),
  })).max(500),
});
export const constructionPackageSchema = z.strictObject({
  kind: z.literal('package'),
  schemaVersion: z.literal(1),
  paper: paperSizeSchema.default('A4'),
  scale: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  revisionId: z.uuid(), revisionName: name, issuedAt: z.string(),
  productionId: z.uuid(), productionName: name,
  inventory: z.array(inventoryPanelSchema).max(500),
  scenes: z.array(constructionSnapshotSchema).min(1).max(250),
  sceneLists: z.array(scenePartsListSchema).min(1).max(250),
  stock: packageStockSchema,
});
export type ConstructionPackage = z.infer<typeof constructionPackageSchema>;
export type ScenePartsList = z.infer<typeof scenePartsListSchema>;

function labelsOf(panels: readonly InventoryPanel[]) {
  return Object.fromEntries(panels.map(item => [item.id, item.label]));
}

function wallPart(wall: Scene['layout']['walls'][number], panels: readonly InventoryPanel[]) {
  const match = wall.panelId ? panels.find(item => item.id === wall.panelId) : undefined;
  return {
    wallId: wall.id, label: wall.label, assemblyNumber: wall.assemblyNumber,
    panelId: wall.panelId, panelLabel: match?.label,
    width: wall.width, height: wall.height, thickness: wall.thickness,
    x: wall.x, y: wall.y, rotation: wall.rotation,
  };
}

function sceneList(scene: Scene, snapshot: ConstructionSnapshot, panels: readonly InventoryPanel[]): ScenePartsList {
  return {
    sceneId: scene.id, sceneName: snapshot.sceneName,
    materials: sceneMaterials(snapshot.layout),
    walls: snapshot.layout.walls.map(wall => wallPart(wall, panels)),
    braces: (snapshot.layout.braces ?? []).map(brace => ({
      id: brace.id, label: brace.label, ballast: brace.ballast,
      footprintWidth: brace.footprintWidth, footprintDepth: brace.footprintDepth, height: brace.height,
    })),
    inventoryWarnings: inventoryWarnings(snapshot.layout, panels),
    overheadWarnings: snapshot.warnings,
    keepClearWarnings: snapshot.unresolvedWarnings,
    riggingNotes: snapshot.layout.riggingNotes,
  };
}

function stockFrom(lists: readonly ScenePartsList[], panels: readonly InventoryPanel[]) {
  const byId = new Map(panels.map(item => [item.id, item]));
  const appearances = new Map<string, { count: number; sceneNames: string[] }>();
  const unassigned: z.infer<typeof stockUnassignedSchema>[] = [];
  const unavailable: z.infer<typeof stockUnavailableSchema>[] = [];
  const conflicts: ConstructionPackage['stock']['conflicts'] = [];
  for (const list of lists) {
    for (const wall of list.walls) {
      if (!wall.panelId) {
        unassigned.push({ sceneId: list.sceneId, sceneName: list.sceneName, wallId: wall.wallId, wallLabel: wall.label });
        continue;
      }
      const seen = appearances.get(wall.panelId) ?? { count: 0, sceneNames: [] };
      seen.count += 1;
      if (!seen.sceneNames.includes(list.sceneName)) seen.sceneNames.push(list.sceneName);
      appearances.set(wall.panelId, seen);
    }
    for (const warning of list.inventoryWarnings) {
      if (warning.kind === 'unavailable' && warning.wallId && warning.panelId) {
        const wall = list.walls.find(item => item.wallId === warning.wallId);
        const panel = byId.get(warning.panelId);
        unavailable.push({
          sceneId: list.sceneId, sceneName: list.sceneName, wallId: warning.wallId,
          wallLabel: wall?.label ?? warning.wallId, panelId: warning.panelId,
          panelLabel: panel?.label ?? wall?.panelLabel ?? warning.panelId,
        });
      }
      if (warning.kind === 'duplicate' || warning.kind === 'incompatible') {
        conflicts.push({ ...warning, kind: warning.kind, sceneName: list.sceneName });
      }
    }
  }
  const stockPanels = [...appearances.entries()].map(([panelId, seen]) => {
    const panel = byId.get(panelId);
    return {
      panelId, label: panel?.label ?? panelId, available: panel?.available ?? false,
      note: panel?.note ?? null, appearances: seen.count, sceneNames: seen.sceneNames,
    };
  });
  return {
    physicalPanels: stockPanels.length, appearances: stockPanels.reduce((sum, item) => sum + item.appearances, 0),
    panels: stockPanels, unassigned, unavailable, conflicts,
  };
}

export function freezePackage(
  scenes: readonly Scene[],
  revision: {
    id: string; name: string; issuedAt: Date; paper?: PaperSize; scale?: DrawingScale;
    elevationGroupIds?: string[]; layers?: Partial<ExportLayers>;
  },
  panels: readonly InventoryPanel[] = [],
  ballastStock: BallastStock = EMPTY_BALLAST_STOCK,
): ConstructionPackage {
  if (!scenes.length) throw new Error('A package needs at least one scene.');
  const productionId = scenes[0]!.productionId;
  if (scenes.some(scene => scene.productionId !== productionId)) throw new Error('Scenes must belong to one production.');
  const inventory = structuredClone(panels) as InventoryPanel[];
  const snapshots = scenes.map(scene => freezeSnapshot(scene, revision, labelsOf(inventory)));
  const sceneLists = scenes.map((scene, index) => sceneList(scene, snapshots[index]!, inventory));
  return constructionPackageSchema.parse({
    kind: 'package', schemaVersion: 1, paper: revision.paper ?? 'A4', scale: revision.scale ?? DRAWING_SCALE,
    revisionId: revision.id, revisionName: revision.name, issuedAt: revision.issuedAt.toISOString(),
    productionId, productionName: scenes[0]!.productionName,
    inventory, scenes: snapshots, sceneLists, stock: { ...stockFrom(sceneLists, inventory), venueMaterials: [...new Set(scenes.map(scene => scene.venueId))].map(venueId => {
      const matching = scenes.filter(scene => scene.venueId === venueId);
      return { venueId, venueName: matching[0]!.venueName, ...materialRequirements(matching.map(scene => scene.layout), ballastStock) };
    }) },
  });
}
