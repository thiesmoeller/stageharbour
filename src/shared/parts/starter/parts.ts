import type { PartDefinition, PartRef } from '../definition.js';

const id = (serial: number) => `5a17e9a0-0000-4000-8000-${String(serial).padStart(12, '0')}`;

const LEG_HEIGHTS_MM = [200, 400, 600, 800, 1000, 1200];

/** Triangle of 40 × 40 Latte behind a wall: stile, floor rail and diagonal. */
export const STARTER_BRACE: PartDefinition = {
  id: id(1), revision: 1, name: 'Stützdreieck', category: 'Stützen',
  description: 'Dreieck aus Latte 40 × 40: Wandstiel, Bodenschwelle und Strebe. Beschwerung als Zubehör.',
  parameters: [
    { key: 'T', label: 'Tiefe', type: 'length', default: 500, scope: 'variant', range: { min: 200, max: 1500 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 1200, scope: 'variant', range: { min: 300, max: 3000 } },
    { key: 'ballast', label: 'Betonplatten', type: 'count', default: 0, scope: 'placement', values: [0, 1, 2] },
  ],
  variants: [
    { key: 'standard', label: '50 × 120 cm', values: { T: 500, H: 1200 } },
    { key: 'niedrig', label: '40 × 90 cm', values: { T: 400, H: 900 } },
    { key: 'hoch', label: '80 × 240 cm', values: { T: 800, H: 2400 } },
  ],
  derived: [
    { key: 's', label: 'Lattenstärke', formula: 40 },
    { key: 'wandZ', label: 'Achse Wandstiel', formula: '-T / 2 + s / 2' },
    { key: 'spitzeZ', label: 'Achse Schwellenende', formula: 'T / 2 - s / 2' },
  ],
  bodies: [
    { kind: 'beam', key: 'stiel', label: 'Wandstiel', material: 'latte-40x40', from: [0, 0, 'wandZ'], to: [0, 'H', 'wandZ'] },
    { kind: 'beam', key: 'schwelle', label: 'Bodenschwelle', material: 'latte-40x40', from: [0, 's / 2', '-T / 2'], to: [0, 's / 2', 'T / 2'] },
    { kind: 'beam', key: 'strebe', label: 'Strebe', material: 'latte-40x40', from: [0, 's / 2', 'spitzeZ'], to: [0, 'H - s / 2', 'wandZ'] },
  ],
  connectors: [
    { key: 'wand', label: 'Wandseite', kind: 'brace-mount', at: [0, 0, '-T / 2'], axis: [0, 0, -1] },
  ],
  traits: { stock: 'count' },
  hardware: [
    { material: 'betonplatte-400', quantity: 'ballast' },
    { material: 'spanngurt-25', quantity: 1, when: 'ballast >= 2' },
  ],
};

/** Leg of a Bühnenelement, named by the deck height it gives. */
export const STARTER_DECK_LEG: PartDefinition = {
  id: id(2), revision: 1, name: 'Steckfuß', category: 'Podeste',
  description: 'Steckfuß 50 × 50 mm mit Gummifuß. Die Höhe nennt die Podesthöhe, die er mit einem 80 mm hohen Bühnenelement ergibt.',
  parameters: [
    { key: 'H', label: 'Podesthöhe', type: 'length', default: 600, scope: 'variant', values: LEG_HEIGHTS_MM },
  ],
  variants: LEG_HEIGHTS_MM.map(height => ({ key: String(height), label: `${height / 10} cm`, values: { H: height } })),
  derived: [
    { key: 'aufbau', label: 'Aufbauhöhe Bühnenelement', formula: 80 },
    { key: 'gummi', label: 'Höhe Gummifuß', formula: 12 },
    { key: 'kopf', label: 'Oberkante Rohr', formula: 'H - aufbau' },
  ],
  bodies: [
    { kind: 'box', key: 'gummifuss', label: 'Gummifuß', material: 'gummifuss-50', size: [50, 'gummi', 50], at: [0, 'gummi / 2', 0] },
    { kind: 'beam', key: 'rohr', label: 'Rohr', material: 'steckfuss-rohr-50', from: [0, 'gummi', 0], to: [0, 'kopf', 0] },
  ],
  connectors: [
    { key: 'kopf', label: 'Kopf', kind: 'leg-socket', at: [0, 'kopf', 0], axis: [0, 1, 0] },
    { key: 'boden', label: 'Standfläche', kind: 'floor', at: [0, 0, 0], axis: [0, -1, 0] },
  ],
  traits: { stock: 'count' },
};

const DECK_LEG_REF: PartRef = { id: STARTER_DECK_LEG.id, revision: STARTER_DECK_LEG.revision };

/** Stage deck module on four legs. */
export const STARTER_DECK: PartDefinition = {
  id: id(3), revision: 1, name: 'Bühnenelement', category: 'Podeste',
  description: 'Bühnenelement mit Aluminiumrahmen, Deckplatte und vier Steckfüßen.',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 2000, scope: 'variant', values: [1000, 2000] },
    { key: 'T', label: 'Tiefe', type: 'length', default: 1000, scope: 'variant', values: [500, 1000] },
    { key: 'H', label: 'Podesthöhe', type: 'length', default: 600, scope: 'placement', values: LEG_HEIGHTS_MM },
  ],
  variants: [
    { key: '2x1', label: '2 × 1 m', values: { B: 2000, T: 1000 } },
    { key: '2x05', label: '2 × 0,5 m', values: { B: 2000, T: 500 } },
    { key: '1x1', label: '1 × 1 m', values: { B: 1000, T: 1000 } },
    { key: '1x05', label: '1 × 0,5 m', values: { B: 1000, T: 500 } },
  ],
  derived: [
    { key: 'einzug', label: 'Fußachse ab Kante', formula: 33 },
    { key: 'staerke', label: 'Stärke Deckplatte', formula: 12 },
    { key: 'rahmenB', label: 'Rahmenbreite', formula: 40 },
    { key: 'rahmenH', label: 'Rahmenhöhe', formula: 68 },
    { key: 'rahmenY', label: 'Achse Rahmen', formula: 'H - staerke - rahmenH / 2' },
    { key: 'unten', label: 'Unterkante Rahmen', formula: 'H - staerke - rahmenH' },
    { key: 'fussX', label: 'Fußachse quer', formula: 'B / 2 - einzug' },
    { key: 'fussZ', label: 'Fußachse längs', formula: 'T / 2 - einzug' },
  ],
  bodies: [
    {
      kind: 'sheet', key: 'platte', label: 'Deckplatte', material: 'sperrholz-12', plane: 'xz', at: [0, 'H', 0],
      outline: { shape: 'rect', x: '-B / 2', y: '-T / 2', width: 'B', height: 'T' },
    },
    {
      kind: 'beam', key: 'rahmen-lang', label: 'Rahmen längs', material: 'buehnenrahmen-40x68',
      from: ['-B / 2', 'rahmenY', '-(T - rahmenB) / 2'], to: ['B / 2', 'rahmenY', '-(T - rahmenB) / 2'],
      repeat: { count: 2, step: [0, 0, 'T - rahmenB'] },
    },
    {
      kind: 'beam', key: 'rahmen-quer', label: 'Rahmen quer', material: 'buehnenrahmen-40x68',
      from: ['-(B - rahmenB) / 2', 'rahmenY', '-T / 2 + rahmenB'], to: ['-(B - rahmenB) / 2', 'rahmenY', 'T / 2 - rahmenB'],
      repeat: { count: 2, step: ['B - rahmenB', 0, 0] },
    },
  ],
  children: [
    {
      key: 'fuss', label: 'Steckfuß', part: DECK_LEG_REF, values: { H: 'H' }, at: ['-fussX', 0, '-fussZ'],
      repeat: [{ count: 2, step: ['2 * fussX', 0, 0] }, { count: 2, step: [0, 0, '2 * fussZ'] }],
    },
  ],
  connectors: [
    { key: 'kante-vorn', label: 'Kante vorn', kind: 'deck-edge', at: ['-B / 2', 'H', '-T / 2'], axis: [1, 0, 0], length: 'B' },
    { key: 'kante-hinten', label: 'Kante hinten', kind: 'deck-edge', at: ['-B / 2', 'H', 'T / 2'], axis: [1, 0, 0], length: 'B' },
    { key: 'kante-links', label: 'Kante links', kind: 'deck-edge', at: ['-B / 2', 'H', '-T / 2'], axis: [0, 0, 1], length: 'T' },
    { key: 'kante-rechts', label: 'Kante rechts', kind: 'deck-edge', at: ['B / 2', 'H', '-T / 2'], axis: [0, 0, 1], length: 'T' },
    { key: 'fuss-vl', label: 'Fuß vorn links', kind: 'leg-socket', at: ['-fussX', 'unten', '-fussZ'], axis: [0, -1, 0] },
    { key: 'fuss-vr', label: 'Fuß vorn rechts', kind: 'leg-socket', at: ['fussX', 'unten', '-fussZ'], axis: [0, -1, 0] },
    { key: 'fuss-hl', label: 'Fuß hinten links', kind: 'leg-socket', at: ['-fussX', 'unten', 'fussZ'], axis: [0, -1, 0] },
    { key: 'fuss-hr', label: 'Fuß hinten rechts', kind: 'leg-socket', at: ['fussX', 'unten', 'fussZ'], axis: [0, -1, 0] },
  ],
  traits: {
    surface: { body: 'platte' },
    faces: [{ key: 'belag', label: 'Belag', body: 'platte', side: 'front' }],
    stock: 'item',
  },
};

/** Wall panel 1200 × 2400 × 28 mm, plain or with a door opening. */
export const STARTER_WALL: PartDefinition = {
  id: id(4), revision: 1, name: 'Wandelement', category: 'Wände',
  description: 'Wandelement 120 × 240 cm aus 28 mm Tischlerplatte, wahlweise mit Türöffnung 80 × 200 cm.',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 1200, scope: 'variant', range: { min: 1000, max: 1250 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 2400, scope: 'variant', range: { min: 2100, max: 3000 } },
    { key: 'tuer', label: 'Türöffnung', type: 'toggle', default: 0, scope: 'variant' },
  ],
  variants: [
    { key: 'voll', label: 'Vollwand', values: { B: 1200, H: 2400, tuer: 0 } },
    { key: 'tuer', label: 'Mit Türöffnung', values: { B: 1200, H: 2400, tuer: 1 } },
  ],
  derived: [
    { key: 'staerke', label: 'Wandstärke', formula: 28 },
    { key: 'tuerB', label: 'Türbreite', formula: 800 },
    { key: 'tuerH', label: 'Türhöhe', formula: 2000 },
  ],
  bodies: [
    {
      kind: 'sheet', key: 'platte', label: 'Wandplatte', material: 'tischlerplatte-28', plane: 'xy', anchor: 'centre', at: [0, 0, 0],
      outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' },
      holes: [{ shape: 'rect', key: 'tuer', when: 'tuer', x: '-tuerB / 2', y: 0, width: 'tuerB', height: 'tuerH' }],
    },
  ],
  connectors: [
    { key: 'links', label: 'Linke Kante', kind: 'hinge-edge', at: ['-B / 2', 0, 0], axis: [0, 1, 0], length: 'H' },
    { key: 'rechts', label: 'Rechte Kante', kind: 'hinge-edge', at: ['B / 2', 0, 0], axis: [0, 1, 0], length: 'H' },
    { key: 'stuetze', label: 'Rückseite', kind: 'brace-mount', at: [0, 0, 'staerke / 2'], axis: [0, 0, 1] },
  ],
  traits: {
    faces: [
      { key: 'front', label: 'Vorderseite', body: 'platte', side: 'front' },
      { key: 'back', label: 'Rückseite', body: 'platte', side: 'back' },
      { key: 'edge', label: 'Kanten', body: 'platte', side: 'edge' },
    ],
    stock: 'item',
  },
};

/** Table with a free size: a top on four legs. */
export const STARTER_TABLE: PartDefinition = {
  id: id(5), revision: 1, name: 'Tisch', category: 'Möbel',
  description: 'Tisch mit Platte aus 28 mm Tischlerplatte auf vier Beinen aus Latte 40 × 40.',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 1200, scope: 'placement', range: { min: 600, max: 2400, step: 10 } },
    { key: 'T', label: 'Tiefe', type: 'length', default: 800, scope: 'placement', range: { min: 400, max: 1200, step: 10 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 750, scope: 'placement', range: { min: 500, max: 1100, step: 10 } },
  ],
  derived: [
    { key: 'staerke', label: 'Plattenstärke', formula: 28 },
    { key: 'beinX', label: 'Beinachse quer', formula: 'B / 2 - 60' },
    { key: 'beinZ', label: 'Beinachse längs', formula: 'T / 2 - 60' },
  ],
  bodies: [
    {
      kind: 'sheet', key: 'platte', label: 'Tischplatte', material: 'tischlerplatte-28', plane: 'xz', at: [0, 'H', 0],
      outline: { shape: 'rect', x: '-B / 2', y: '-T / 2', width: 'B', height: 'T' },
    },
    {
      kind: 'beam', key: 'bein', label: 'Bein', material: 'latte-40x40',
      from: ['-beinX', 0, '-beinZ'], to: ['-beinX', 'H - staerke', '-beinZ'],
      repeat: [{ count: 2, step: ['2 * beinX', 0, 0] }, { count: 2, step: [0, 0, '2 * beinZ'] }],
    },
  ],
  traits: {
    faces: [{ key: 'platte', label: 'Tischplatte', body: 'platte', side: 'front' }],
    stock: 'none',
  },
};

export const STARTER_PARTS: PartDefinition[] = [STARTER_BRACE, STARTER_DECK_LEG, STARTER_DECK, STARTER_WALL, STARTER_TABLE];
