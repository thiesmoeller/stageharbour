import { DEFAULT_BRANDING } from '../../shared/contracts.js';
import { EMPTY_BALLAST_STOCK } from '../../shared/ballast.js';
import { groupWallType } from '../../shared/inventory.js';
import { STARTER_PART_IDS } from '../../shared/parts/starter/index.js';
import { emptyCatalog, ensureStarterCatalog } from './catalog.js';
import { SNAPSHOT_SCHEMA_VERSION, type LocalSnapshot } from './snapshot.js';

/** Stable demo IDs so local mode and tests can address the same rows. */
export const LOCAL_SEED_IDS = {
  workspace: 'a1000000-0000-4000-8000-000000000001',
  venue: 'a2000000-0000-4000-8000-000000000001',
  venueVersion: 'a3000000-0000-4000-8000-000000000001',
  production: 'a4000000-0000-4000-8000-000000000001',
  scene: 'a5000000-0000-4000-8000-000000000001',
  wall1: 'a6000000-0000-4000-8000-000000000001',
  wall2: 'a6000000-0000-4000-8000-000000000002',
  wall3: 'a6000000-0000-4000-8000-000000000003',
  typePlain: 'a7000000-0000-4000-8000-000000000001',
  typeDoor: 'a7000000-0000-4000-8000-000000000002',
  openingDoor: 'a8000000-0000-4000-8000-000000000001',
  panelPlain: 'a9000000-0000-4000-8000-000000000001',
  panelDoor: 'a9000000-0000-4000-8000-000000000002',
} as const;

export function createSeedSnapshot(): LocalSnapshot {
  const plainType = groupWallType('plain', LOCAL_SEED_IDS.typePlain);
  const doorType = groupWallType('doorLeft', LOCAL_SEED_IDS.typeDoor, LOCAL_SEED_IDS.openingDoor);
  const venueGeometry = {
    schemaVersion: 1 as const,
    width: 8000,
    depth: 6000,
  };
  const now = new Date();
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    savedAt: now.toISOString(),
    user: {
      id: 'local-user',
      name: 'Demo-Nutzer',
      email: 'demo@local.test',
    },
    workspace: {
      id: LOCAL_SEED_IDS.workspace,
      name: 'Beispiel-Theatergruppe',
      role: 'administrator',
    },
    branding: { ...DEFAULT_BRANDING },
    productions: [{ id: LOCAL_SEED_IDS.production, name: 'Beispielproduktion' }],
    venues: [{ id: LOCAL_SEED_IDS.venue, name: 'Beispielsaal' }],
    venueVersions: [{
      id: LOCAL_SEED_IDS.venueVersion,
      venueId: LOCAL_SEED_IDS.venue,
      geometry: venueGeometry,
      createdAt: '2024-01-01T00:00:00.000Z',
    }],
    scenes: [{
      id: LOCAL_SEED_IDS.scene,
      name: 'Bühnenbild 1',
      productionId: LOCAL_SEED_IDS.production,
      venueVersionId: LOCAL_SEED_IDS.venueVersion,
      revision: 0,
      lease: null,
      layout: {
        schemaVersion: 2,
        objects: [
          { id: LOCAL_SEED_IDS.wall1, label: 'Wand', part: { id: STARTER_PART_IDS.wall, revision: 1 }, variant: 'plain', values: { B: 1200, H: 2400, D: 28 }, x: 2000, y: 2000, rotation: 0 },
          { id: LOCAL_SEED_IDS.wall2, label: 'Wand', part: { id: STARTER_PART_IDS.wall, revision: 1 }, variant: 'plain', values: { B: 1200, H: 2400, D: 28 }, x: 3200, y: 2000, rotation: 0 },
          { id: LOCAL_SEED_IDS.wall3, label: 'Wand', part: { id: STARTER_PART_IDS.wall, revision: 1 }, variant: 'plain', values: { B: 1200, H: 2400, D: 28 }, x: 4400, y: 2000, rotation: 90 },
        ],
        joints: [],
      },
    }],
    inventory: {
      ballast: EMPTY_BALLAST_STOCK,
      lease: null,
      types: [plainType, doorType],
      panels: [
        {
          id: LOCAL_SEED_IDS.panelPlain,
          label: 'G-01',
          typeId: plainType.id,
          available: true,
          note: null,
          type: plainType,
        },
        {
          id: LOCAL_SEED_IDS.panelDoor,
          label: 'T-01',
          typeId: doorType.id,
          available: true,
          note: null,
          type: doorType,
        },
      ],
    },
    documentDrafts: {},
    sceneTemplates: [],
    catalog: ensureStarterCatalog(emptyCatalog(), now),
  };
}
