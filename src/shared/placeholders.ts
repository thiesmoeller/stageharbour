import { z } from 'zod';
import { AUDIENCE_FLOOR_ID } from './levels.js';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const coordinate = z.number().finite().min(-100000).max(100000);
/** Example-only millimetre placeholders for furniture, people and equipment. Not measured inventory. */
export const PLACEHOLDER_EXAMPLE_NOTICE = 'Beispielmaße, keine gemessene Inventarvorgabe.';
export const PLACEHOLDER_DEFERRED_NOTICE = 'CAD-Import und Leuchtenplatzierung sind zurückgestellt.';
export const EXAMPLE_TABLE_WIDTH = 1200;
export const EXAMPLE_TABLE_DEPTH = 800;
export const EXAMPLE_TABLE_HEIGHT = 750;
export const EXAMPLE_CHAIR_WIDTH = 450;
export const EXAMPLE_CHAIR_DEPTH = 450;
export const EXAMPLE_CHAIR_HEIGHT = 900;
export const EXAMPLE_PERSON_WIDTH = 500;
export const EXAMPLE_PERSON_DEPTH = 400;
export const EXAMPLE_PERSON_HEIGHT = 1750;
export const EXAMPLE_SPEAKER_WIDTH = 400;
export const EXAMPLE_SPEAKER_DEPTH = 350;
export const EXAMPLE_SPEAKER_HEIGHT = 600;
export const EXAMPLE_BOX_WIDTH = 600;
export const EXAMPLE_BOX_DEPTH = 600;
export const EXAMPLE_BOX_HEIGHT = 600;

export const PLACEHOLDER_KINDS = ['table', 'chair', 'person', 'speaker', 'box'] as const;
export const placeholderKindSchema = z.enum(PLACEHOLDER_KINDS);
export type PlaceholderKind = z.infer<typeof placeholderKindSchema>;
export const PLACEHOLDER_KIND_LABELS: Record<PlaceholderKind, string> = {
  table: 'Tisch', chair: 'Stuhl', person: 'Person', speaker: 'Lautsprecher', box: 'Kiste',
};
const exampleSize: Record<PlaceholderKind, { width: number; depth: number; height: number }> = {
  table: { width: EXAMPLE_TABLE_WIDTH, depth: EXAMPLE_TABLE_DEPTH, height: EXAMPLE_TABLE_HEIGHT },
  chair: { width: EXAMPLE_CHAIR_WIDTH, depth: EXAMPLE_CHAIR_DEPTH, height: EXAMPLE_CHAIR_HEIGHT },
  person: { width: EXAMPLE_PERSON_WIDTH, depth: EXAMPLE_PERSON_DEPTH, height: EXAMPLE_PERSON_HEIGHT },
  speaker: { width: EXAMPLE_SPEAKER_WIDTH, depth: EXAMPLE_SPEAKER_DEPTH, height: EXAMPLE_SPEAKER_HEIGHT },
  box: { width: EXAMPLE_BOX_WIDTH, depth: EXAMPLE_BOX_DEPTH, height: EXAMPLE_BOX_HEIGHT },
};

export const placeholderSchema = z.strictObject({
  id: z.uuid(), kind: placeholderKindSchema, label: name,
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360),
  width: dimension, depth: dimension, height: dimension,
  supportingSurfaceId: z.uuid().optional(),
});
export type Placeholder = z.infer<typeof placeholderSchema>;
export const placeholdersSchema = z.array(placeholderSchema).max(250)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Placeholder IDs must be unique');

export function newPlaceholder(kind: PlaceholderKind, id: string, x: number, y: number): Placeholder {
  return {
    id, kind, label: PLACEHOLDER_KIND_LABELS[kind], x, y, rotation: 0,
    ...exampleSize[kind], supportingSurfaceId: AUDIENCE_FLOOR_ID,
  };
}

// Millimetres, centre anchor, +x audience-right, +y away from the audience.
export function placeholderCorners(item: Pick<Placeholder, 'x' | 'y' | 'rotation' | 'width' | 'depth'>): { x: number; y: number }[] {
  const angle = item.rotation * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x * item.width / 2, dy = y * item.depth / 2;
    return { x: item.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: item.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}

export type PlaceholderSolid = {
  id: string; kind: PlaceholderKind; label: string;
  size: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
  rotationY: number;
};

export function placeholderSolid(item: Placeholder, elevation = 0): PlaceholderSolid {
  return {
    id: item.id, kind: item.kind, label: item.label,
    size: { x: item.width, y: item.height, z: item.depth },
    center: { x: item.x, y: elevation + item.height / 2, z: item.y },
    rotationY: -item.rotation * Math.PI / 180,
  };
}
