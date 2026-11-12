import { PART_SCHEMA_VERSION, createPartContext, type PartContext, type PartLibrary } from '../definition.js';
import { STARTER_MATERIALS } from './materials.js';
import { STARTER_PARTS } from './parts.js';

export { STARTER_MATERIALS } from './materials.js';
export {
  STARTER_BOX, STARTER_BRACE, STARTER_CHAIR, STARTER_DECK, STARTER_DECK_LEG, STARTER_DOOR,
  STARTER_FLOATING_PLATFORM, STARTER_PART_IDS, STARTER_PARTS, STARTER_PERSON, STARTER_SOLID_PLATFORM,
  STARTER_SPEAKER, STARTER_STAIR, STARTER_TABLE, STARTER_WALL,
} from './parts.js';

/** Stable built-in library used for new workspaces and v1 layout conversion. */
export const STARTER_LIBRARY: PartLibrary = {
  schemaVersion: PART_SCHEMA_VERSION,
  materials: STARTER_MATERIALS,
  parts: STARTER_PARTS,
};

export const STARTER_CONTEXT: PartContext = createPartContext(STARTER_LIBRARY);
