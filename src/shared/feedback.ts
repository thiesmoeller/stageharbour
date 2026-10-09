import { z } from 'zod';

export const FEEDBACK_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const short = z.string().max(200);
export const feedbackPageSchema = z.object({
  section: z.enum(['plans', 'venues', 'bestand', 'account', 'admin', 'help']),
  sceneId: z.uuid().optional(), venueId: z.uuid().optional(),
}).strict();
export const feedbackActivitySchema = z.object({
  at: z.iso.datetime(),
  action: z.enum(['navigation', 'editor.change', 'editor.undo', 'editor.redo', 'editor.save', 'api.failure', 'save.saved', 'save.pending', 'save.saving', 'save.failed', 'save.conflict']),
  area: z.enum(['plans', 'venues', 'bestand', 'account', 'admin', 'help', 'api']).optional(),
  status: z.number().int().min(0).max(599).optional(),
  operation: z.enum(['scenes', 'venues', 'inventory', 'exports', 'assets', 'account', 'feedback', 'workspace', 'other']).optional(),
}).strict();
export type FeedbackActivity = z.infer<typeof feedbackActivitySchema>;
export const feedbackWorkSchema = z.object({
  productionId: z.uuid().optional(), sceneId: z.uuid().optional(), venueId: z.uuid().optional(),
  production: short.optional(), layout: short.optional(), venue: short.optional(),
  revision: z.number().int().nonnegative().optional(), venueVersionId: short.optional(),
  view: short.optional(), tool: short.optional(), saveStatus: short.optional(),
  dirty: z.boolean().optional(), unappliedInputs: z.boolean().optional(), readOnly: z.boolean().optional(),
  selection: z.array(short).max(200).optional(),
  display: z.record(z.string().max(60), z.union([z.boolean(), z.number().finite(), short])).refine(v => Object.keys(v).length <= 40).optional(),
}).strict();
export type FeedbackWork = z.infer<typeof feedbackWorkSchema>;
export const feedbackImageSchema = z.object({
  type: z.enum(['image/png', 'image/jpeg']),
  base64: z.string().max(Math.ceil(FEEDBACK_ATTACHMENT_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export const feedbackSchema = z.object({
  category: z.enum(['issue', 'feature']), message: z.string().trim().min(1).max(4000),
  capturedAt: z.iso.datetime(), page: feedbackPageSchema,
  browser: z.string().max(500), viewport: z.object({ width: z.number().int().min(1).max(100000), height: z.number().int().min(1).max(100000) }).strict(),
  work: feedbackWorkSchema.optional(), activity: z.array(feedbackActivitySchema).max(30).optional(),
  images: z.array(feedbackImageSchema).max(2).default([]),
  snapshot: z.string().max(FEEDBACK_ATTACHMENT_BYTES).optional(),
}).strict();
export type FeedbackReport = z.infer<typeof feedbackSchema>;
export type FeedbackImage = z.infer<typeof feedbackImageSchema>;
export const feedbackOptionsSchema = z.object({ enabled: z.boolean(), version: z.string() });

export function feedbackHash(page: z.infer<typeof feedbackPageSchema>): string {
  if (page.section === 'plans') return page.sceneId ? `#/szenen/${page.sceneId}` : '#/produktionen';
  if (page.section === 'venues') return page.venueId ? `#/spielstaetten/${page.venueId}` : '#/spielstaetten';
  return `#/${{ bestand: 'bestand', account: 'konto', admin: 'verwaltung', help: 'hilfe' }[page.section]}`;
}

export function feedbackPageLabel(page: z.infer<typeof feedbackPageSchema>): string {
  return { plans: 'Bühnenbilder', venues: 'Spielstätten', bestand: 'Bestand', account: 'Konto', admin: 'Verwaltung', help: 'Hilfe' }[page.section];
}
