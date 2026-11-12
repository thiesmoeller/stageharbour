import type { PartDefinition } from '../../src/shared/parts/definition.js';

export const testId = (serial: number) => `c47a1090-0000-4000-8000-${String(serial).padStart(12, '0')}`;

/** Small part of one beam with two variants, stocked as labelled pieces. */
export function crate(serial: number, name = `Kiste ${serial}`, overrides: Partial<PartDefinition> = {}): PartDefinition {
  return {
    id: testId(serial), revision: 1, name, category: 'Test',
    parameters: [{ key: 'B', label: 'Breite', type: 'length', default: 600, scope: 'variant', range: { min: 300, max: 1200 } }],
    variants: [{ key: 'klein', label: 'Klein', values: { B: 400 } }, { key: 'gross', label: 'Groß', values: { B: 900 } }],
    bodies: [{ kind: 'beam', key: 'latte', material: 'latte-40x40', from: [0, 0, 0], to: ['B', 0, 0] }],
    traits: { stock: 'item' },
    ...overrides,
  };
}
