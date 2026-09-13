import { z } from 'zod';

const level = z.number().finite().min(0).max(200);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const stageLightingSchema = z.strictObject({
  enabled: z.boolean(), front: level, back: level, ambient: z.number().finite().min(0).max(100),
  frontColor: color, backColor: color,
  height: z.number().finite().min(1000).max(12000),
  beam: z.number().finite().min(20).max(120),
});
export type StageLightingSettings = z.infer<typeof stageLightingSchema>;
export const defaultLighting: StageLightingSettings = {
  enabled: false, front: 100, back: 40, ambient: 28,
  frontColor: '#ffe0b3', backColor: '#a9c8ff', height: 4500, beam: 80,
};
export const lightingPresets = {
  rehearsal: { label: 'Probe', front: 100, back: 35, ambient: 50, frontColor: '#ffffff', backColor: '#ffffff' },
  warm: { label: 'Warm', front: 100, back: 40, ambient: 28, frontColor: '#ffd19a', backColor: '#ffab66' },
  cool: { label: 'Kühl', front: 100, back: 45, ambient: 26, frontColor: '#c1d8ff', backColor: '#6e8cff' },
  dramatic: { label: 'Dramatisch', front: 70, back: 90, ambient: 16, frontColor: '#ffbe85', backColor: '#957bff' },
} as const;
