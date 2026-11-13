import type { PartDefinition, PartRef } from '../definition.js';

const id = (serial: number) => `5a17e9a0-0000-4000-8000-${String(serial).padStart(12, '0')}`;

const LEG_HEIGHTS_MM = [200, 400, 600, 800, 1000, 1200];

/** Triangle of 40 × 40 Latte behind a wall: stile, floor rail and diagonal. */
export const STARTER_BRACE: PartDefinition = {
  id: id(1), revision: 1, name: 'Stützdreieck', category: 'Stützen',
  description: 'Dreieck aus Latte 40 × 40: Wandstiel, Bodenschwelle und Strebe. Beschwerung als Zubehör.',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 40, scope: 'placement', range: { min: 1, max: 10000 } },
    { key: 'T', label: 'Tiefe', type: 'length', default: 500, scope: 'variant', range: { min: 200, max: 1500 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 1200, scope: 'variant', range: { min: 300, max: 3000 } },
    { key: 'TO', label: 'Tiefe Altbestand', type: 'count', default: 0, scope: 'placement', range: { min: 0, max: 10000 } },
    { key: 'HO', label: 'Höhe Altbestand', type: 'count', default: 0, scope: 'placement', range: { min: 0, max: 10000 } },
    { key: 'ballast', label: 'Betonplatten', type: 'count', default: 0, scope: 'placement', values: [0, 1, 2] },
  ],
  variants: [
    { key: 'standard', label: '50 × 120 cm', values: { T: 500, H: 1200 } },
    { key: 'niedrig', label: '40 × 90 cm', values: { T: 400, H: 900 } },
    { key: 'hoch', label: '80 × 240 cm', values: { T: 800, H: 2400 } },
  ],
  derived: [
    { key: 'D', label: 'Wirksame Tiefe', formula: 'if(TO > 0, TO, T)' },
    { key: 'L', label: 'Wirksame Höhe', formula: 'if(HO > 0, HO, H)' },
    { key: 's', label: 'Lattenstärke', formula: 40 },
    { key: 'wandZ', label: 'Achse Wandstiel', formula: '-D / 2 + s / 2' },
    { key: 'spitzeZ', label: 'Achse Schwellenende', formula: 'D / 2 - s / 2' },
  ],
  bodies: [
    { kind: 'beam', key: 'stiel', label: 'Wandstiel', material: 'latte-40x40', section: ['B', 's'], from: [0, 0, 'wandZ'], to: [0, 'L', 'wandZ'] },
    { kind: 'beam', key: 'schwelle', label: 'Bodenschwelle', material: 'latte-40x40', section: ['B', 's'], from: [0, 's / 2', '-D / 2'], to: [0, 's / 2', 'D / 2'] },
    { kind: 'beam', key: 'strebe', label: 'Strebe', material: 'latte-40x40', section: ['B', 's'], from: [0, 's / 2', 'spitzeZ'], to: [0, 'L - s / 2', 'wandZ'] },
  ],
  connectors: [
    { key: 'wand', label: 'Wandseite', kind: 'brace-mount', at: [0, 0, '-D / 2'], axis: [0, 0, -1] },
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
    { key: 'HO', label: 'Höhe Altbestand', type: 'count', default: 0, scope: 'placement', range: { min: 0, max: 10000 } },
  ],
  variants: LEG_HEIGHTS_MM.map(height => ({ key: String(height), label: `${height / 10} cm`, values: { H: height } })),
  derived: [
    { key: 'E', label: 'Wirksame Podesthöhe', formula: 'if(HO > 0, HO, H)' },
    { key: 'aufbau', label: 'Aufbauhöhe Bühnenelement', formula: 80 },
    { key: 'gummi', label: 'Höhe Gummifuß', formula: 12 },
    { key: 'kopf', label: 'Oberkante Rohr', formula: 'E - aufbau' },
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
    { key: 'BO', label: 'Breite Altbestand', type: 'count', default: 0, scope: 'placement', range: { min: 0, max: 20000 } },
    { key: 'TO', label: 'Tiefe Altbestand', type: 'count', default: 0, scope: 'placement', range: { min: 0, max: 20000 } },
    { key: 'H', label: 'Podesthöhe', type: 'length', default: 600, scope: 'placement', values: LEG_HEIGHTS_MM },
    { key: 'HO', label: 'Höhe Altbestand', type: 'count', default: 0, scope: 'placement', range: { min: 0, max: 10000 } },
  ],
  variants: [
    { key: '2x1', label: '2 × 1 m', values: { B: 2000, T: 1000 } },
    { key: '2x05', label: '2 × 0,5 m', values: { B: 2000, T: 500 } },
    { key: '1x1', label: '1 × 1 m', values: { B: 1000, T: 1000 } },
    { key: '1x05', label: '1 × 0,5 m', values: { B: 1000, T: 500 } },
  ],
  derived: [
    { key: 'W', label: 'Wirksame Breite', formula: 'if(BO > 0, BO, B)' },
    { key: 'D', label: 'Wirksame Tiefe', formula: 'if(TO > 0, TO, T)' },
    { key: 'E', label: 'Wirksame Höhe', formula: 'if(HO > 0, HO, H)' },
    { key: 'einzug', label: 'Fußachse ab Kante', formula: 33 },
    { key: 'staerke', label: 'Stärke Deckplatte', formula: 12 },
    { key: 'rahmenB', label: 'Rahmenbreite', formula: 40 },
    { key: 'rahmenH', label: 'Rahmenhöhe', formula: 68 },
    { key: 'rahmenY', label: 'Achse Rahmen', formula: 'E - staerke - rahmenH / 2' },
    { key: 'unten', label: 'Unterkante Rahmen', formula: 'E - staerke - rahmenH' },
    { key: 'fussX', label: 'Fußachse quer', formula: 'W / 2 - einzug' },
    { key: 'fussZ', label: 'Fußachse längs', formula: 'D / 2 - einzug' },
  ],
  bodies: [
    {
      kind: 'sheet', key: 'platte', label: 'Deckplatte', material: 'sperrholz-12', plane: 'xz', at: [0, 'E', 0],
      outline: { shape: 'rect', x: '-W / 2', y: '-D / 2', width: 'W', height: 'D' },
    },
    {
      kind: 'beam', key: 'rahmen-lang', label: 'Rahmen längs', material: 'buehnenrahmen-40x68',
      from: ['-W / 2', 'rahmenY', '-(D - rahmenB) / 2'], to: ['W / 2', 'rahmenY', '-(D - rahmenB) / 2'],
      repeat: { count: 2, step: [0, 0, 'D - rahmenB'] },
    },
    {
      kind: 'beam', key: 'rahmen-quer', label: 'Rahmen quer', material: 'buehnenrahmen-40x68',
      from: ['-(W - rahmenB) / 2', 'rahmenY', '-D / 2 + rahmenB'], to: ['-(W - rahmenB) / 2', 'rahmenY', 'D / 2 - rahmenB'],
      repeat: { count: 2, step: ['W - rahmenB', 0, 0] },
    },
  ],
  children: [
    {
      key: 'fuss', label: 'Steckfuß', part: DECK_LEG_REF, values: { H: 'H', HO: 'HO' }, at: ['-fussX', 0, '-fussZ'],
      repeat: [{ count: 2, step: ['2 * fussX', 0, 0] }, { count: 2, step: [0, 0, '2 * fussZ'] }],
    },
  ],
  connectors: [
    { key: 'kante-vorn', label: 'Kante vorn', kind: 'deck-edge', at: ['-W / 2', 'E', '-D / 2'], axis: [1, 0, 0], length: 'W' },
    { key: 'kante-hinten', label: 'Kante hinten', kind: 'deck-edge', at: ['-W / 2', 'E', 'D / 2'], axis: [1, 0, 0], length: 'W' },
    { key: 'kante-links', label: 'Kante links', kind: 'deck-edge', at: ['-W / 2', 'E', '-D / 2'], axis: [0, 0, 1], length: 'D' },
    { key: 'kante-rechts', label: 'Kante rechts', kind: 'deck-edge', at: ['W / 2', 'E', '-D / 2'], axis: [0, 0, 1], length: 'D' },
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

/** White door leaf and scenery frame. The parent wall supplies opening size, hinge hand and state. */
export const STARTER_DOOR: PartDefinition = {
  id: id(6), revision: 1, name: 'Tür', category: 'Wände',
  description: 'Türblatt mit Zarge; der Zustand „offen“ schwenkt das Blatt bis 90°.',
  parameters: [
    { key: 'B', label: 'lichte Breite', type: 'length', default: 800, scope: 'placement', range: { min: 300, max: 2000 } },
    { key: 'H', label: 'lichte Höhe', type: 'length', default: 2000, scope: 'placement', range: { min: 300, max: 4000 } },
    { key: 'hinge', label: 'Anschlag', type: 'count', default: -1, scope: 'placement', values: [-1, 1] },
    { key: 'open', label: 'Öffnung', type: 'percent', default: 0, scope: 'state', range: { min: 0, max: 100, step: 1 } },
  ],
  derived: [
    { key: 'face', label: 'Zargenbreite', formula: 25 },
    { key: 'depth', label: 'Zargentiefe', formula: 50 },
    { key: 'leafD', label: 'Türblattstärke', formula: 40 },
    { key: 'angle', label: 'Öffnungswinkel', formula: 'open * 0.9' },
  ],
  bodies: [
    { kind: 'beam', key: 'zarge-unten', material: 'tuerrahmen-25x50', section: ['face', 'depth'], from: ['-B / 2 - face', '-face / 2', '-depth / 2'], to: ['B / 2 + face', '-face / 2', '-depth / 2'], roll: 90 },
    { kind: 'beam', key: 'zarge-oben', material: 'tuerrahmen-25x50', section: ['face', 'depth'], from: ['-B / 2 - face', 'H + face / 2', '-depth / 2'], to: ['B / 2 + face', 'H + face / 2', '-depth / 2'], roll: 90 },
    { kind: 'box', key: 'zarge-links', material: 'holz-koerper', size: ['face', 'H', 'depth'], at: ['-B / 2 - face / 2', 'H / 2', '-depth / 2'] },
    { kind: 'box', key: 'zarge-rechts', material: 'holz-koerper', size: ['face', 'H', 'depth'], at: ['B / 2 + face / 2', 'H / 2', '-depth / 2'] },
    {
      kind: 'box', key: 'blatt', label: 'Türblatt', material: 'stoff-koerper',
      size: ['B', 'H', 'leafD'], at: [0, 'H / 2', '-leafD / 2'],
      pivot: ['if(hinge < 0, -B / 2, B / 2)', 'H / 2', 0],
      rotation: [0, 'if(hinge < 0, angle, -angle)', 0],
    },
  ],
  connectors: [
    { key: 'band', label: 'Türband', kind: 'hinge-edge', at: ['if(hinge < 0, -B / 2, B / 2)', 0, 0], axis: [0, 1, 0], length: 'H' },
  ],
  traits: {
    faces: [{ key: 'blatt', label: 'Türblatt', body: 'blatt', side: 'front' }],
    stock: 'none',
  },
};

const DOOR_REF: PartRef = { id: STARTER_DOOR.id, revision: STARTER_DOOR.revision };

/** Wall panel with the six group variants. Dimensions remain placement values for one-time v1 conversion. */
export const STARTER_WALL: PartDefinition = {
  id: id(4), revision: 1, name: 'Wandelement', category: 'Wände',
  description: 'Wandelement mit Voll-, Tür-, Fenster-, Bogen- und Halbwand-Varianten.',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 1200, scope: 'placement', range: { min: 100, max: 10000 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 2400, scope: 'placement', range: { min: 100, max: 10000 } },
    { key: 'D', label: 'Stärke', type: 'length', default: 28, scope: 'placement', range: { min: 1, max: 1000 } },
    { key: 'shape', label: 'Bauart', type: 'count', default: 0, scope: 'variant', values: [0, 1, 2, 3, 4, 5] },
    { key: 'tuerLeft', label: 'Tür links · Linke Kante', type: 'length', default: 200, scope: 'placement', range: { min: 0, max: 9000 } },
    { key: 'tuerSill', label: 'Tür links · Brüstung', type: 'length', default: 0, scope: 'placement', values: [0] },
    { key: 'tuerB', label: 'Tür links · Breite', type: 'length', default: 800, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'tuerH', label: 'Tür links · Höhe', type: 'length', default: 2000, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'tuer_hrechtsLeft', label: 'Tür rechts · Linke Kante', type: 'length', default: 200, scope: 'placement', range: { min: 0, max: 9000 } },
    { key: 'tuer_hrechtsSill', label: 'Tür rechts · Brüstung', type: 'length', default: 0, scope: 'placement', values: [0] },
    { key: 'tuer_hrechtsB', label: 'Tür rechts · Breite', type: 'length', default: 800, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'tuer_hrechtsH', label: 'Tür rechts · Höhe', type: 'length', default: 2000, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'fensterLeft', label: 'Fenster · Linke Kante', type: 'length', default: 200, scope: 'placement', range: { min: 0, max: 9000 } },
    { key: 'fensterSill', label: 'Fenster · Brüstung', type: 'length', default: 1, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'fensterB', label: 'Fenster · Breite', type: 'length', default: 800, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'fensterH', label: 'Fenster · Höhe', type: 'length', default: 2000, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'bogenLeft', label: 'Bogen · Linke Kante', type: 'length', default: 200, scope: 'placement', range: { min: 0, max: 9000 } },
    { key: 'bogenSill', label: 'Bogen · Brüstung', type: 'length', default: 1, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'bogenB', label: 'Bogen · Breite', type: 'length', default: 800, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'bogenH', label: 'Bogen · Höhe', type: 'length', default: 2000, scope: 'placement', range: { min: 1, max: 9000 } },
    { key: 'open', label: 'Türöffnung', type: 'percent', default: 0, scope: 'state', range: { min: 0, max: 100, step: 1 } },
  ],
  variants: [
    { key: 'plain', label: 'Glattwand', values: { shape: 0 } },
    { key: 'doorLeft', label: 'Tür · Scharnier links', values: { shape: 1 } },
    { key: 'doorRight', label: 'Tür · Scharnier rechts', values: { shape: 2 } },
    { key: 'window', label: 'Fensterwand', values: { shape: 3 } },
    { key: 'arch', label: 'Bogen', values: { shape: 4 } },
    { key: 'half', label: 'Halbe Wand', values: { shape: 5 } },
  ],
  derived: [{ key: 'W', label: 'Wirksame Breite', formula: 'if(shape == 5, min(B, 600), B)' }],
  bodies: [
    {
      kind: 'sheet', key: 'platte', label: 'Wandplatte', material: 'tischlerplatte-28', plane: 'xy', anchor: 'centre', at: [0, 0, 0],
      thickness: 'D',
      outline: { shape: 'rect', x: '-W / 2', y: 0, width: 'W', height: 'H' },
      holes: [
        {
          shape: 'rect', key: 'tuer', when: 'shape == 1',
          x: '-W / 2 + max(0, min(tuerLeft, W - 1))', y: 'max(0, min(tuerSill, H - 1))',
          width: 'max(1, min(tuerB, W - max(0, min(tuerLeft, W - 1))))',
          height: 'max(1, min(tuerH, H - max(0, min(tuerSill, H - 1)) - 1))',
        },
        {
          shape: 'rect', key: 'tuer-rechts', when: 'shape == 2',
          x: '-W / 2 + max(0, min(tuer_hrechtsLeft, W - 1))', y: 'max(0, min(tuer_hrechtsSill, H - 1))',
          width: 'max(1, min(tuer_hrechtsB, W - max(0, min(tuer_hrechtsLeft, W - 1))))',
          height: 'max(1, min(tuer_hrechtsH, H - max(0, min(tuer_hrechtsSill, H - 1)) - 1))',
        },
        {
          shape: 'rect', key: 'fenster', when: 'shape == 3',
          x: '-W / 2 + max(1, min(fensterLeft, W - 2))', y: 'max(1, min(fensterSill, H - 2))',
          width: 'max(1, min(fensterB, W - max(1, min(fensterLeft, W - 2)) - 1))',
          height: 'max(1, min(fensterH, H - max(1, min(fensterSill, H - 2)) - 1))',
        },
        {
          shape: 'arch', key: 'bogen', when: 'shape == 4',
          x: '-W / 2 + max(1, min(bogenLeft, W - 2))', y: 'max(1, min(bogenSill, H - 2))',
          width: 'max(1, min(bogenB, W - max(1, min(bogenLeft, W - 2)) - 1, 2 * max(1, min(bogenH, H - max(1, min(bogenSill, H - 2)) - 1))))',
          height: 'max(1, min(bogenH, H - max(1, min(bogenSill, H - 2)) - 1))',
        },
      ],
    },
  ],
  children: [
    {
      key: 'tuer', label: 'Tür', part: DOOR_REF, when: 'if(shape == 1, 1, shape == 2)',
      values: {
        B: 'if(shape == 1, tuerB, tuer_hrechtsB)',
        H: 'if(shape == 1, tuerH, tuer_hrechtsH)',
        hinge: 'if(shape == 1, -1, 1)',
        open: 'open',
      },
      at: [
        '-W / 2 + if(shape == 1, tuerLeft + tuerB / 2, tuer_hrechtsLeft + tuer_hrechtsB / 2)',
        'if(shape == 1, tuerSill, tuer_hrechtsSill)',
        '-D / 2',
      ],
    },
  ],
  connectors: [
    { key: 'links', label: 'Linke Kante', kind: 'hinge-edge', at: ['-W / 2', 0, 0], axis: [0, 1, 0], length: 'H' },
    { key: 'rechts', label: 'Rechte Kante', kind: 'hinge-edge', at: ['W / 2', 0, 0], axis: [0, 1, 0], length: 'H' },
    { key: 'stuetze', label: 'Rückseite', kind: 'brace-mount', at: [0, 0, 'D / 2'], axis: [0, 0, 1] },
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

function boxPart(serial: number, name: string, category: string, size: { width: number; depth: number; height: number }): PartDefinition {
  return {
    id: id(serial), revision: 1, name, category,
    parameters: [
      { key: 'B', label: 'Breite', type: 'length', default: size.width, scope: 'placement', range: { min: 50, max: 10000, step: 10 } },
      { key: 'T', label: 'Tiefe', type: 'length', default: size.depth, scope: 'placement', range: { min: 50, max: 10000, step: 10 } },
      { key: 'H', label: 'Höhe', type: 'length', default: size.height, scope: 'placement', range: { min: 50, max: 10000, step: 10 } },
    ],
    bodies: [{ kind: 'box', key: 'koerper', material: 'stoff-koerper', size: ['B', 'H', 'T'], at: [0, 'H / 2', 0] }],
    traits: { stock: 'none' },
  };
}

export const STARTER_CHAIR: PartDefinition = {
  id: id(7), revision: 1, name: 'Stuhl', category: 'Möbel',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 450, scope: 'placement', range: { min: 100, max: 2000, step: 10 } },
    { key: 'T', label: 'Tiefe', type: 'length', default: 450, scope: 'placement', range: { min: 100, max: 2000, step: 10 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 900, scope: 'placement', range: { min: 200, max: 3000, step: 10 } },
    { key: 'seated', label: 'Sitzfigur', type: 'toggle', default: 0, scope: 'state' },
  ],
  derived: [
    { key: 'seatH', formula: 'H * 0.48' },
    { key: 'seatT', formula: 'max(20, H * 0.06)' },
    { key: 'backT', formula: 'max(20, T * 0.08)' },
    { key: 'leg', formula: 'max(18, min(B, T) * 0.08)' },
  ],
  bodies: [
    { kind: 'box', key: 'sitz', material: 'holz-koerper', size: ['B * 0.92', 'seatT', 'T * 0.75'], at: [0, 'seatH', 0] },
    { kind: 'box', key: 'lehne', material: 'holz-koerper', size: ['B * 0.92', 'H - seatH', 'backT'], at: [0, 'seatH + (H - seatH) / 2', '-T * 0.32'] },
    {
      kind: 'box', key: 'bein', material: 'holz-koerper', size: ['leg', 'seatH', 'leg'],
      at: ['-B * 0.38', 'seatH / 2', '-T * 0.28'],
      repeat: [{ count: 2, step: ['B * 0.76', 0, 0] }, { count: 2, step: [0, 0, 'T * 0.56'] }],
    },
    { kind: 'box', key: 'figur-rumpf', material: 'stoff-koerper', when: 'seated', size: ['B * 0.35', 'H * 0.28', 'T * 0.28'], at: [0, 'seatH + seatT / 2 + H * 0.18', 'T * 0.02'] },
    {
      kind: 'box', key: 'figur-beine', material: 'stoff-koerper', when: 'seated',
      size: ['B * 0.32', 'H * 0.12', 'T * 0.35'], at: [0, 'seatH + seatT / 2 + H * 0.06', 'T * 0.14'],
      rotation: [22.9183, 0, 0],
    },
    { kind: 'box', key: 'figur-kopf', material: 'stoff-koerper', when: 'seated', size: ['min(B, T) * 0.24', 'min(B, T) * 0.24', 'min(B, T) * 0.24'], at: [0, 'seatH + seatT / 2 + H * 0.38', 'T * 0.02'] },
  ],
  traits: { stock: 'none', planSymbol: 'solids' },
};

export const STARTER_PERSON = boxPart(8, 'Person', 'Darsteller', { width: 500, depth: 400, height: 1750 });
export const STARTER_SPEAKER = boxPart(9, 'Lautsprecher', 'Technik', { width: 400, depth: 350, height: 600 });
export const STARTER_BOX = boxPart(10, 'Kiste', 'Requisite', { width: 600, depth: 600, height: 600 });

/** Straight stair from its lower support to height H. */
export const STARTER_STAIR: PartDefinition = {
  id: id(11), revision: 1, name: 'Treppe', category: 'Podeste',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 1200, scope: 'placement', range: { min: 200, max: 5000 } },
    { key: 'T', label: 'Lauflänge', type: 'length', default: 2000, scope: 'placement', range: { min: 200, max: 10000 } },
    { key: 'H', label: 'Steighöhe', type: 'length', default: 400, scope: 'placement', range: { min: 1, max: 5000 } },
    { key: 'R', label: 'bevorzugte Stufenhöhe', type: 'length', default: 160, scope: 'placement', range: { min: 50, max: 500 } },
  ],
  derived: [
    { key: 'n', label: 'Stufen', formula: 'max(1, round(H / R))' },
    { key: 'stepH', formula: 'H / n' },
    { key: 'stepT', formula: 'T / n' },
  ],
  bodies: [{
    kind: 'box', key: 'stufe', material: 'holz-koerper',
    size: ['B', 'stepH', 'stepT'], at: [0, 'stepH / 2', '-T / 2 + stepT / 2'],
    repeat: { count: 'n', step: [0, 'stepH', 'stepT'] },
  }],
  connectors: [
    { key: 'unten', label: 'Unterer Anschluss', kind: 'deck-edge', at: ['-B / 2', 0, '-T / 2'], axis: [1, 0, 0], length: 'B' },
    { key: 'oben', label: 'Oberer Anschluss', kind: 'deck-edge', at: ['-B / 2', 'H', 'T / 2'], axis: [1, 0, 0], length: 'B' },
  ],
  traits: { stock: 'none', planSymbol: 'stair' },
};

export const STARTER_FLOATING_PLATFORM: PartDefinition = {
  id: id(12), revision: 1, name: 'Schwebendes Podest', category: 'Podeste',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 2000, scope: 'placement', range: { min: 100, max: 20000 } },
    { key: 'T', label: 'Tiefe', type: 'length', default: 1000, scope: 'placement', range: { min: 100, max: 20000 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 400, scope: 'placement', range: { min: 40, max: 5000 } },
  ],
  bodies: [{ kind: 'box', key: 'platte', material: 'holz-koerper', size: ['B', 40, 'T'], at: [0, 'H - 20', 0] }],
  connectors: [
    { key: 'kante-vorn', kind: 'deck-edge', at: ['-B / 2', 'H', '-T / 2'], axis: [1, 0, 0], length: 'B' },
  ],
  traits: {
    surface: { body: 'platte' },
    faces: [{ key: 'top', label: 'Belag', body: 'platte', side: 'top' }, { key: 'sides', label: 'Seiten', body: 'platte', side: 'all' }],
    stock: 'none',
  },
};

export const STARTER_SOLID_PLATFORM: PartDefinition = {
  id: id(13), revision: 1, name: 'Massives Podest', category: 'Podeste',
  parameters: [
    { key: 'B', label: 'Breite', type: 'length', default: 2000, scope: 'placement', range: { min: 100, max: 20000 } },
    { key: 'T', label: 'Tiefe', type: 'length', default: 1000, scope: 'placement', range: { min: 100, max: 20000 } },
    { key: 'H', label: 'Höhe', type: 'length', default: 400, scope: 'placement', range: { min: 1, max: 5000 } },
  ],
  bodies: [{ kind: 'box', key: 'block', material: 'holz-koerper', size: ['B', 'H', 'T'], at: [0, 'H / 2', 0] }],
  connectors: [
    { key: 'kante-vorn', kind: 'deck-edge', at: ['-B / 2', 'H', '-T / 2'], axis: [1, 0, 0], length: 'B' },
  ],
  traits: {
    surface: { body: 'block' },
    faces: [{ key: 'top', label: 'Belag', body: 'block', side: 'top' }, { key: 'sides', label: 'Seiten', body: 'block', side: 'all' }],
    stock: 'none',
  },
};

export const STARTER_PARTS: PartDefinition[] = [
  STARTER_BRACE, STARTER_DECK_LEG, STARTER_DECK, STARTER_WALL, STARTER_TABLE, STARTER_DOOR,
  STARTER_CHAIR, STARTER_PERSON, STARTER_SPEAKER, STARTER_BOX, STARTER_STAIR,
  STARTER_FLOATING_PLATFORM, STARTER_SOLID_PLATFORM,
];

export const STARTER_PART_IDS = {
  brace: STARTER_BRACE.id,
  deckLeg: STARTER_DECK_LEG.id,
  deck: STARTER_DECK.id,
  wall: STARTER_WALL.id,
  table: STARTER_TABLE.id,
  door: STARTER_DOOR.id,
  chair: STARTER_CHAIR.id,
  person: STARTER_PERSON.id,
  speaker: STARTER_SPEAKER.id,
  box: STARTER_BOX.id,
  stair: STARTER_STAIR.id,
  floatingPlatform: STARTER_FLOATING_PLATFORM.id,
  solidPlatform: STARTER_SOLID_PLATFORM.id,
} as const;
