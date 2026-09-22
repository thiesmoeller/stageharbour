import { z } from 'zod';

/**
 * Visual construction-report sheet layout (InDesign / Canva-style page composer).
 * Frames place plan crops or 3D views on paper; templates are reusable layouts.
 */
export const reportFrameKindSchema = z.enum(['plan', 'elevation', 'view3d', 'notes']);
export type ReportFrameKind = z.infer<typeof reportFrameKindSchema>;

export const reportFrameSchema = z.strictObject({
  id: z.uuid(),
  kind: reportFrameKindSchema,
  /** Position on the sheet in millimetres from top-left of the drawing area. */
  x: z.number().finite().min(0).max(1000),
  y: z.number().finite().min(0).max(1000),
  width: z.number().finite().min(10).max(1000),
  height: z.number().finite().min(10).max(1000),
  /** 0 or 90 — rotate frame to pack more on A4. */
  rotation: z.union([z.literal(0), z.literal(90)]).default(0),
  /** Optional camera / elevation preset for view3d / elevation frames. */
  view: z.enum(['orbit', 'audience', 'top', 'front', 'side', 'north', 'south', 'east', 'west']).optional(),
  label: z.string().trim().max(80).optional(),
});
export type ReportFrame = z.infer<typeof reportFrameSchema>;

export const reportPageSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  paper: z.enum(['a4', 'a3']).default('a4'),
  frames: z.array(reportFrameSchema).max(40),
});
export type ReportPage = z.infer<typeof reportPageSchema>;

export const reportTemplateSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  pages: z.array(reportPageSchema).min(1).max(40),
});
export type ReportTemplate = z.infer<typeof reportTemplateSchema>;

export const reportTemplatesSchema = z.array(reportTemplateSchema).max(50)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Report template IDs must be unique');

/** A4 portrait drawing area inside typical title/footer margins (mm). */
export const REPORT_A4_DRAWING_MM = { width: 180, height: 220 } as const;

export function newReportFrame(id: string, kind: ReportFrameKind, extras?: Partial<ReportFrame>): ReportFrame {
  const defaults = kind === 'notes'
    ? { width: 180, height: 40, x: 0, y: 180 }
    : { width: 90, height: 100, x: 0, y: 0 };
  return {
    id, kind, rotation: 0, ...defaults, ...extras,
  };
}

export function newReportTemplate(id: string, name = 'Standardblatt'): ReportTemplate {
  const planId = globalThis.crypto.randomUUID();
  const viewId = globalThis.crypto.randomUUID();
  return {
    id, name,
    pages: [{
      id: globalThis.crypto.randomUUID(), name: 'Blatt 1', paper: 'a4',
      frames: [
        newReportFrame(planId, 'plan', { x: 0, y: 0, width: 110, height: 160, label: 'Grundriss' }),
        newReportFrame(viewId, 'view3d', { x: 115, y: 0, width: 65, height: 100, view: 'orbit', label: '3D' }),
        newReportFrame(globalThis.crypto.randomUUID(), 'elevation', { x: 0, y: 165, width: 180, height: 50, view: 'front', label: 'Ansicht vorne' }),
      ],
    }],
  };
}

/** Swap width/height when rotating 90° so the frame still packs on the sheet. */
export function rotateReportFrame(frame: ReportFrame): ReportFrame {
  const next = frame.rotation === 0 ? 90 : 0;
  return { ...frame, rotation: next as 0 | 90, width: frame.height, height: frame.width };
}
