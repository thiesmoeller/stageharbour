import { z } from 'zod';

/**
 * Visual construction-report sheet layout (InDesign / Canva-style page composer).
 * Frames place plan crops or 3D views on paper; templates are reusable layouts.
 */
export const reportFrameKindSchema = z.enum(['plan', 'elevation', 'view3d', 'notes', 'schedule']);
export type ReportFrameKind = z.infer<typeof reportFrameKindSchema>;

/** Same presets as the editor Kamerablick / orthogonal elevations. */
export const reportViewSchema = z.enum(['orbit', 'audience', 'top', 'front', 'side']);
export type ReportView = z.infer<typeof reportViewSchema>;

export const REPORT_VIEW_LABELS: Record<ReportView, string> = {
  orbit: 'Umlaufansicht',
  audience: 'Publikumssicht',
  top: 'Von oben',
  front: 'Von vorne',
  side: 'Von der Seite',
};

/** Construction sheets default to scenery crop (no audience hall). */
export const reportPlanScopeSchema = z.enum(['scenery', 'venue']);
export type ReportPlanScope = z.infer<typeof reportPlanScopeSchema>;

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
  /** Camera / elevation preset matching StageView Kamerablick. */
  view: reportViewSchema.optional(),
  /** Plan crop: scenery = set pieces only; venue = full hall including audience. */
  planScope: reportPlanScopeSchema.optional(),
  label: z.string().trim().max(80).optional(),
  scale: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
  crop: z.strictObject({
    minX: z.number().finite(), minY: z.number().finite(), maxX: z.number().finite(), maxY: z.number().finite(),
  }).optional(),
  sourceRole: z.enum(['primary', 'each']).optional(),
  groupIndex: z.number().int().min(0).max(40).optional(),
  camera: z.strictObject({
    projection: z.enum(['perspective', 'orthographic']),
    position: z.strictObject({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
    target: z.strictObject({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
    preset: reportViewSchema.optional(),
  }).optional(),
});
export type ReportFrame = z.infer<typeof reportFrameSchema>;

export const reportPageSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  paper: z.enum(['a4', 'a3']).default('a4'),
  orientation: z.enum(['portrait', 'landscape']).optional(),
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

/** Lightweight update: report templates only (avoids shipping the full venue geometry). */
export const saveReportTemplatesSchema = z.strictObject({
  venueVersionId: z.uuid().optional(),
  reportTemplates: reportTemplatesSchema,
});

/** A4 portrait drawing area inside typical title/footer margins (mm). */
export const REPORT_A4_DRAWING_MM = { width: 180, height: 220 } as const;

export function newReportFrame(id: string, kind: ReportFrameKind, extras?: Partial<ReportFrame>): ReportFrame {
  const defaults = kind === 'notes'
    ? { width: 180, height: 40, x: 0, y: 180 }
    : kind === 'plan'
      ? { width: 90, height: 100, x: 0, y: 0, planScope: 'scenery' as const, label: 'Grundriss Bühnenbild' }
      : kind === 'view3d'
        ? { width: 90, height: 100, x: 0, y: 0, view: 'orbit' as const }
        : kind === 'elevation'
          ? { width: 90, height: 100, x: 0, y: 0, view: 'front' as const }
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
        newReportFrame(planId, 'plan', {
          x: 0, y: 0, width: 110, height: 160,
          planScope: 'scenery', label: 'Grundriss Bühnenbild',
        }),
        newReportFrame(viewId, 'view3d', {
          x: 115, y: 0, width: 65, height: 100, view: 'orbit', label: 'Umlaufansicht',
        }),
        newReportFrame(globalThis.crypto.randomUUID(), 'elevation', {
          x: 0, y: 165, width: 180, height: 50, view: 'front', label: 'Von vorne',
        }),
      ],
    }],
  };
}

/** Swap width/height when rotating 90° so the frame still packs on the sheet. */
export function rotateReportFrame(frame: ReportFrame): ReportFrame {
  const next = frame.rotation === 0 ? 90 : 0;
  return { ...frame, rotation: next as 0 | 90, width: frame.height, height: frame.width };
}
