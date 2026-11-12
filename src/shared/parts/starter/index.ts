import { PART_SCHEMA_VERSION, createPartContext, type PartContext, type PartLibrary } from '../definition.js';
import { STARTER_MATERIALS } from './materials.js';
import { STARTER_PARTS } from './parts.js';

export { STARTER_MATERIALS } from './materials.js';
export { STARTER_BRACE, STARTER_DECK, STARTER_DECK_LEG, STARTER_PARTS, STARTER_TABLE, STARTER_WALL } from './parts.js';

/** Example definitions that prove the model. The built-in library of the product comes later. */
export const STARTER_LIBRARY: PartLibrary = {
  schemaVersion: PART_SCHEMA_VERSION,
  materials: STARTER_MATERIALS,
  parts: STARTER_PARTS,
};

export const STARTER_CONTEXT: PartContext = createPartContext(STARTER_LIBRARY);
