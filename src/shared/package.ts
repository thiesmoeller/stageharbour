import { z } from 'zod';
import {
  CONSTRUCTION_SNAPSHOT_VERSION, constructionSnapshotSchema, DRAWING_SCALE, freezeExportSchema, freezeSnapshot, paperSizeSchema,
  type ConstructionSnapshot, type FreezeSource,
} from './export.js';
import type { ExportLayers } from './exportLayers.js';
import { combinedFrozenLists, frozenLists } from './frozenParts.js';
import type { Scene } from './layout.js';
import type { BuildLists } from './partLists.js';
import type { DrawingScale, PaperSize } from './tiling.js';

const name = z.string().trim().min(1).max(120);

export const freezePackageSchema = freezeExportSchema.extend({
  sceneIds: z.array(z.uuid()).min(1).max(250),
}).refine(body => new Set(body.sceneIds).size === body.sceneIds.length, 'Scene IDs must be unique');

/**
 * A frozen construction package: one snapshot per Bühnenbild, each with the part revisions and
 * stock it used. Parts lists, cut lists and stock demand are derived from the snapshots.
 */
export const constructionPackageSchema = z.strictObject({
  kind: z.literal('package'),
  schemaVersion: z.literal(CONSTRUCTION_SNAPSHOT_VERSION),
  paper: paperSizeSchema.default('A4'),
  scale: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  revisionId: z.uuid(), revisionName: name, issuedAt: z.string(),
  productionId: z.uuid(), productionName: name,
  sceneIds: z.array(z.uuid()).min(1).max(250),
  scenes: z.array(constructionSnapshotSchema).min(1).max(250),
});
export type ConstructionPackage = z.infer<typeof constructionPackageSchema>;

export function freezePackage(
  scenes: readonly Scene[],
  revision: {
    id: string; name: string; issuedAt: Date; paper?: PaperSize; scale?: DrawingScale;
    elevationGroupIds?: string[]; layers?: Partial<ExportLayers>;
  },
  source?: FreezeSource,
): ConstructionPackage {
  if (!scenes.length) throw new Error('A package needs at least one scene.');
  const productionId = scenes[0]!.productionId;
  if (scenes.some(scene => scene.productionId !== productionId)) throw new Error('Scenes must belong to one production.');
  return constructionPackageSchema.parse({
    kind: 'package', schemaVersion: CONSTRUCTION_SNAPSHOT_VERSION, paper: revision.paper ?? 'A4', scale: revision.scale ?? DRAWING_SCALE,
    revisionId: revision.id, revisionName: revision.name, issuedAt: revision.issuedAt.toISOString(),
    productionId, productionName: scenes[0]!.productionName,
    sceneIds: scenes.map(scene => scene.id),
    scenes: scenes.map(scene => freezeSnapshot(scene, revision, source)),
  });
}

export type PackageLists = {
  scenes: { sceneId: string; sceneName: string; venueName: string; lists: BuildLists }[];
  /** One entry per venue visit: the Bühnenbilder adapted to one venue version. */
  visits: { venueVersionId: string; venueName: string; sceneNames: string[]; lists: BuildLists }[];
  total: BuildLists;
};

/** Lists per Bühnenbild, per venue visit and for the whole package. */
export function packageLists(scenes: readonly { sceneId: string; snapshot: ConstructionSnapshot }[]): PackageLists {
  const entries = scenes.map(({ sceneId, snapshot }) => ({
    frozen: snapshot, scene: { id: sceneId, name: snapshot.sceneName }, snapshot,
  }));
  const visits = new Map<string, typeof entries>();
  for (const entry of entries) visits.set(entry.snapshot.venueVersionId, [...visits.get(entry.snapshot.venueVersionId) ?? [], entry]);
  return {
    scenes: entries.map(entry => ({
      sceneId: entry.scene.id, sceneName: entry.scene.name, venueName: entry.snapshot.venueName,
      lists: frozenLists(entry.frozen, entry.scene),
    })),
    visits: [...visits.entries()].map(([venueVersionId, items]) => ({
      venueVersionId, venueName: items[0]!.snapshot.venueName, sceneNames: items.map(item => item.scene.name),
      lists: combinedFrozenLists(items),
    })),
    total: combinedFrozenLists(entries),
  };
}
