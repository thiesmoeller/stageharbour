import {
  createPartContext, type PartContext, type PartDefinition, type PartMaterial, type PartRef,
} from '../../src/shared/parts/definition.js';
import { STARTER_DECK, STARTER_MATERIALS, STARTER_PARTS } from '../../src/shared/parts/starter/index.js';

export const fixtureId = (serial: number) => `7e570000-0000-4000-8000-${String(serial).padStart(12, '0')}`;
export const refOf = (definition: PartDefinition): PartRef => ({ id: definition.id, revision: definition.revision });

export const FIXTURE_MATERIALS: PartMaterial[] = [
  ...STARTER_MATERIALS,
  { kind: 'hardware', key: 'kiste', name: 'Transportkiste', weightKgPerPiece: 4, color: '#555555' },
  { kind: 'sheet', key: 'fixture-tuerblatt-40', name: 'Türblatt 40 mm', thickness: 40, weightKgPerM2: 20, color: '#8a5a2b' },
  { kind: 'profile', key: 'zarge-60x28', name: 'Zargenprofil 60 × 28 mm', section: { width: 60, height: 28 }, weightKgPerM: 1.2, color: '#eeeeee' },
];

/** Stützdreieck with a free timber width, to compare with `braceMembers` beyond 40 mm. */
export const WIDE_BRACE: PartDefinition = {
  id: fixtureId(1), revision: 1, name: 'Stützdreieck breit', category: 'Stützen',
  parameters: [
    { key: 'W', label: 'Breite', type: 'length', default: 40, scope: 'placement', range: { min: 20, max: 200 } },
    { key: 'T', label: 'Tiefe', type: 'length', default: 500, scope: 'placement', range: { min: 200, max: 1500 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 1200, scope: 'placement', range: { min: 300, max: 3000 } },
  ],
  derived: [
    { key: 's', formula: 40 },
    { key: 'wandZ', formula: '-T / 2 + s / 2' },
    { key: 'spitzeZ', formula: 'T / 2 - s / 2' },
  ],
  bodies: [
    { kind: 'beam', key: 'stiel', material: 'latte-40x40', section: ['W', 's'], from: [0, 0, 'wandZ'], to: [0, 'H', 'wandZ'] },
    { kind: 'beam', key: 'schwelle', material: 'latte-40x40', section: ['W', 's'], from: [0, 's / 2', '-T / 2'], to: [0, 's / 2', 'T / 2'] },
    { kind: 'beam', key: 'strebe', material: 'latte-40x40', section: ['W', 's'], from: [0, 's / 2', 'spitzeZ'], to: [0, 'H - s / 2', 'wandZ'] },
  ],
  traits: { stock: 'count' },
};

/** Door leaf hinged on its local origin: outline from the hinge edge towards +X. */
export const DOOR_LEAF: PartDefinition = {
  id: fixtureId(2), revision: 1, name: 'Türblatt', category: 'Türen',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 800, scope: 'variant', range: { min: 500, max: 1200 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 2000, scope: 'variant', range: { min: 1800, max: 2400 } },
  ],
  bodies: [
    {
      kind: 'sheet', key: 'blatt', material: 'fixture-tuerblatt-40', plane: 'xy', anchor: 'centre', at: [0, 0, 0],
      outline: { shape: 'rect', x: 0, y: 0, width: 'B', height: 'H' },
    },
  ],
  traits: { faces: [{ key: 'front', label: 'Vorderseite', body: 'blatt', side: 'front' }], stock: 'item' },
};

/** Wall with a door opening, a frame of three beams and a leaf that swings with the state `offen`. */
export const DOOR_WALL: PartDefinition = {
  id: fixtureId(3), revision: 1, name: 'Türwand', category: 'Wände',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 1200, scope: 'variant', range: { min: 1000, max: 2000 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 2400, scope: 'variant', range: { min: 2100, max: 3000 } },
    { key: 'offen', label: 'Tür offen', type: 'angle', default: 0, scope: 'state', range: { min: 0, max: 120 } },
  ],
  derived: [
    { key: 'tuerB', formula: 800 },
    { key: 'tuerH', formula: 2000 },
  ],
  bodies: [
    {
      kind: 'sheet', key: 'platte', material: 'tischlerplatte-28', plane: 'xy', anchor: 'centre', at: [0, 0, 0],
      outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' },
      holes: [{ shape: 'rect', key: 'tuer', x: '-tuerB / 2', y: 0, width: 'tuerB', height: 'tuerH' }],
    },
    {
      kind: 'beam', key: 'zarge-seite', material: 'zarge-60x28',
      from: ['-tuerB / 2 + 14', 0, 0], to: ['-tuerB / 2 + 14', 'tuerH', 0], roll: 90,
      repeat: { count: 2, step: ['tuerB - 28', 0, 0] },
    },
    {
      kind: 'beam', key: 'zarge-sturz', material: 'zarge-60x28',
      from: ['-tuerB / 2 + 28', 'tuerH - 14', 0], to: ['tuerB / 2 - 28', 'tuerH - 14', 0],
    },
  ],
  children: [
    {
      key: 'blatt', part: refOf(DOOR_LEAF), values: { B: 'tuerB - 56', H: 'tuerH - 28' },
      at: ['-tuerB / 2 + 28', 0, 0], rotation: [0, 'offen', 0],
    },
  ],
  traits: { stock: 'item' },
};

/** Straight flight: treads placed through the repeat index, two stringers. */
export const STAIR: PartDefinition = {
  id: fixtureId(4), revision: 1, name: 'Treppe gerade', category: 'Treppen',
  parameters: [
    { key: 'n', label: 'Stufen', type: 'count', default: 4, scope: 'placement', range: { min: 2, max: 12 } },
    { key: 'B', label: 'Breite', type: 'length', default: 900, scope: 'placement', range: { min: 600, max: 1500 } },
  ],
  derived: [
    { key: 'steigung', formula: 180 },
    { key: 'auftritt', formula: 270 },
  ],
  bodies: [
    {
      kind: 'sheet', key: 'stufe', material: 'tischlerplatte-28', plane: 'xz',
      at: [0, '(stufe_nr + 1) * steigung', 'stufe_nr * auftritt'],
      outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'auftritt' },
      repeat: { count: 'n', step: [0, 0, 0], index: 'stufe_nr' },
    },
    {
      kind: 'beam', key: 'wange', material: 'latte-40x40',
      from: ['-B / 2 - 20', 20, 0], to: ['-B / 2 - 20', 'n * steigung - 20', 'n * auftritt'],
      repeat: { count: 2, step: ['B + 40', 0, 0] },
    },
  ],
  traits: { surface: { body: 'stufe' }, stock: 'item', planSymbol: 'stair' },
};

/** Row of Bühnenelemente 2 × 1 m: children two levels deep (Podest, Bühnenelement, Steckfuß). */
export const DECK_ROW: PartDefinition = {
  id: fixtureId(5), revision: 1, name: 'Podestreihe', category: 'Podeste',
  parameters: [
    { key: 'n', label: 'Elemente', type: 'count', default: 2, scope: 'placement', range: { min: 1, max: 6 } },
    { key: 'H', label: 'Podesthöhe', type: 'length', default: 600, scope: 'placement', values: [200, 400, 600, 800, 1000, 1200] },
  ],
  bodies: [],
  children: [
    {
      key: 'modul', part: refOf(STARTER_DECK), variant: '2x1', values: { H: 'H' },
      at: [0, 0, '-(n - 1) * 500'], repeat: { count: 'n', step: [0, 0, 1000] },
    },
  ],
  traits: { stock: 'none' },
};

/** Chair: box seat block (hardware piece), four legs, a back sheet. */
export const CHAIR: PartDefinition = {
  id: fixtureId(6), revision: 1, name: 'Stuhl', category: 'Möbel',
  parameters: [],
  bodies: [
    { kind: 'box', key: 'sitz', material: 'kiste', size: [440, 40, 440], at: [0, 450, 0] },
    {
      kind: 'beam', key: 'bein', material: 'latte-40x40', from: [-200, 0, -200], to: [-200, 430, -200],
      repeat: [{ count: 2, step: [400, 0, 0] }, { count: 2, step: [0, 0, 400] }],
    },
    {
      kind: 'sheet', key: 'lehne', material: 'sperrholz-12', plane: 'xy', at: [0, 470, 208],
      outline: { shape: 'rect', x: -220, y: 0, width: 440, height: 400 },
    },
  ],
  traits: { stock: 'count' },
};

export const FIXTURE_PARTS: PartDefinition[] = [...STARTER_PARTS, WIDE_BRACE, DOOR_LEAF, DOOR_WALL, STAIR, DECK_ROW, CHAIR];
export const FIXTURE_CONTEXT: PartContext = createPartContext({ materials: FIXTURE_MATERIALS, parts: FIXTURE_PARTS });

/** A minimal one-sheet part for tests that vary a single field. */
export function panel(overrides: Partial<PartDefinition> = {}): PartDefinition {
  return {
    id: fixtureId(100), revision: 1, name: 'Testplatte', category: 'Test',
    parameters: [
      { key: 'B', label: 'Breite', type: 'length', default: 1000, scope: 'placement', range: { min: 500, max: 2000 } },
      { key: 'H', label: 'Höhe', type: 'length', default: 2000, scope: 'placement', range: { min: 1000, max: 3000 } },
    ],
    bodies: [
      {
        kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
        outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' },
      },
    ],
    traits: { stock: 'none' },
    ...overrides,
  };
}

export const closeTo = (actual: number, expected: number, tolerance = 1e-6) => Math.abs(actual - expected) <= tolerance;
