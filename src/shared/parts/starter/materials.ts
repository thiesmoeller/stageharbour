import type { PartMaterial } from '../definition.js';

/** Example stock materials. Weights are typical catalogue values, not measured stock. */
export const STARTER_MATERIALS: PartMaterial[] = [
  {
    kind: 'profile', key: 'latte-40x40', name: 'Latte 40 × 40 mm (Fichte)',
    section: { width: 40, height: 40 }, weightKgPerM: 0.75, color: '#d9c6a1',
  },
  {
    kind: 'profile', key: 'steckfuss-rohr-50', name: 'Steckfuß-Rohr 50 × 50 mm (Aluminium)',
    section: { width: 50, height: 50 }, weightKgPerM: 1.5, color: '#b8bcc0',
  },
  {
    kind: 'profile', key: 'buehnenrahmen-40x68', name: 'Bühnenrahmen-Profil 40 × 68 mm (Aluminium)',
    section: { width: 40, height: 68 }, weightKgPerM: 1.6, color: '#b8bcc0',
  },
  {
    kind: 'sheet', key: 'sperrholz-12', name: 'Sperrholz 12 mm (Birke)',
    thickness: 12, weightKgPerM2: 8, color: '#c9a877',
  },
  {
    kind: 'sheet', key: 'tischlerplatte-28', name: 'Tischlerplatte 28 mm',
    thickness: 28, weightKgPerM2: 12.5, color: '#315d49',
  },
  { kind: 'hardware', key: 'gummifuss-50', name: 'Gummifuß 50 × 50 mm', weightKgPerPiece: 0.05, color: '#1a1a1a' },
  {
    kind: 'hardware', key: 'betonplatte-400', name: 'Betonplatte 400 × 400 × 50 mm',
    weightKgPerPiece: 18, color: '#9a9a94',
  },
  { kind: 'hardware', key: 'spanngurt-25', name: 'Spanngurt 25 mm', weightKgPerPiece: 0.3, color: '#c0392b' },
];
