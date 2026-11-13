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
  {
    kind: 'sheet', key: 'tuerblatt-40', name: 'Türblatt 40 mm',
    thickness: 40, weightKgPerM2: 10, color: '#f7f7f4',
  },
  {
    kind: 'profile', key: 'tuerrahmen-25x50', name: 'Türzarge 25 × 50 mm',
    section: { width: 25, height: 50 }, weightKgPerM: 0.7, color: '#e8e2d6',
  },
  {
    kind: 'hardware', key: 'aluminium-koerper', name: 'Aluminiumkörper',
    weightKgPerPiece: 0, color: '#c4c8cd',
  },
  {
    kind: 'hardware', key: 'phenol-koerper', name: 'Phenolharz-Körper',
    weightKgPerPiece: 0, color: '#4a3426',
  },
  {
    kind: 'hardware', key: 'holz-koerper', name: 'Holzkörper',
    weightKgPerPiece: 0, color: '#9a7959',
  },
  {
    kind: 'hardware', key: 'stoff-koerper', name: 'Darstellungskörper',
    weightKgPerPiece: 0, color: '#8fa07a',
  },
  { kind: 'hardware', key: 'gummifuss-50', name: 'Gummifuß 50 × 50 mm', weightKgPerPiece: 0.05, color: '#1a1a1a' },
  {
    kind: 'hardware', key: 'betonplatte-400', name: 'Betonplatte 400 × 400 × 50 mm',
    weightKgPerPiece: 18, color: '#9a9a94',
  },
  { kind: 'hardware', key: 'spanngurt-25', name: 'Spanngurt 25 mm', weightKgPerPiece: 0.3, color: '#c0392b' },
];
