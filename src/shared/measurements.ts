import { z } from 'zod';
import { type PlanPoint } from './venue.js';

const coordinate = z.number().finite().min(-100000).max(100000);

/** User-drawn measure line on the plan (venue build-out callouts). */
export const measureLineSchema = z.strictObject({
  id: z.uuid(),
  x1: coordinate, y1: coordinate,
  x2: coordinate, y2: coordinate,
  label: z.string().trim().max(80).optional(),
});
export type MeasureLine = z.infer<typeof measureLineSchema>;
export const measureLinesSchema = z.array(measureLineSchema).max(500)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Measure line IDs must be unique');

export function measureLineLength(line: Pick<MeasureLine, 'x1' | 'y1' | 'x2' | 'y2'>): number {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

export function measureLineMidpoint(line: Pick<MeasureLine, 'x1' | 'y1' | 'x2' | 'y2'>): PlanPoint {
  return { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 };
}

export function measureLineCaption(line: MeasureLine): string {
  if (line.label?.trim()) return line.label.trim();
  return `${Math.round(measureLineLength(line))} mm`;
}

export function newMeasureLine(id: string, start: PlanPoint, end: PlanPoint): MeasureLine {
  return { id, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
