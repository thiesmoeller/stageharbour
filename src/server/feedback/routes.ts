import { inspectReference } from '../venues/files.js';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { feedbackSchema, feedbackOptionsSchema, feedbackHash, feedbackPageLabel, FEEDBACK_ATTACHMENT_BYTES } from '../../shared/feedback.js';
import { layoutSchema, venueGeometrySchema } from '../../shared/layout.js';
import { workspaceParamsSchema, errorSchema } from '../../shared/contracts.js';
import type { Config } from '../config.js';
import { AccessError, type createAccess } from '../identity/access.js';
import type { MailTransport, MailAttachment } from '../mail/transport.js';

const snapshotSchema = z.object({ version: z.literal(1), kind: z.enum(['layout', 'venue']), layout: layoutSchema.optional(), venue: venueGeometrySchema }).strict();
export function feedbackEnabled(config: Config) {
  return Boolean(config.FEEDBACK_TO_EMAIL && (config.NODE_ENV === 'test' ||
    (config.MAIL_FROM && ((config.MAIL_HOST && config.MAIL_USER && config.MAIL_PASS) || config.BREVO_API_KEY))));
}
export function registerFeedbackRoutes(app: FastifyInstance, access: ReturnType<typeof createAccess>, config: Config, mail: MailTransport, clock: () => Date) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const attempts = new Map<string, { count: number; until: number }>();
  api.get('/api/feedback-options', { schema: { response: { 200: feedbackOptionsSchema } } }, async request => {
    await access(request, config.WORKSPACE_ID);
    return { enabled: feedbackEnabled(config), version: config.APP_VERSION };
  });
  api.post('/api/workspaces/:workspaceId/feedback', {
    bodyLimit: 10 * 1024 * 1024,
    schema: { params: workspaceParamsSchema, body: feedbackSchema, response: { 200: z.object({ sent: z.literal(true) }), 429: errorSchema } },
  }, async (request, reply) => {
    const me = await access(request, request.params.workspaceId);
    if (request.headers.origin !== config.APP_ORIGIN) throw new AccessError(403, 'Ungültiger Ursprung.');
    if (!feedbackEnabled(config)) throw new AccessError(503, 'Feedback-Versand ist nicht konfiguriert.');
    const now = clock().getTime();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const rate = attempts.get(me.user.id) ?? { count: 0, until: now + 60_000 };
    if (rate.count >= 5) return reply.code(429).header('Retry-After', Math.ceil((rate.until - now) / 1000)).send({ message: 'Zu viele Versuche. Bitte warten Sie eine Minute.' });
    rate.count++; attempts.set(me.user.id, rate);
    const report = request.body;
    const attachments: MailAttachment[] = [];
    for (const [index, image] of report.images.entries()) {
      const bytes = Buffer.from(image.base64, 'base64');
      if (bytes.length > FEEDBACK_ATTACHMENT_BYTES) throw new AccessError(400, 'Bild ist zu groß.');
      try { await inspectReference(bytes, image.type); }
      catch { throw new AccessError(400, 'Ungültiges Bild.'); }
      attachments.push({ filename: `feedback-${index + 1}.${image.type === 'image/png' ? 'png' : 'jpg'}`, contentType: image.type, content: bytes });
    }
    if (report.snapshot !== undefined) {
      let value: unknown;
      try { value = JSON.parse(report.snapshot); } catch { throw new AccessError(400, 'Ungültiger Entwurf.'); }
      const parsed = snapshotSchema.safeParse(value);
      if (!parsed.success || Buffer.byteLength(report.snapshot) > FEEDBACK_ATTACHMENT_BYTES || (parsed.data.kind === 'layout' && !parsed.data.layout)) throw new AccessError(400, 'Ungültiger oder zu großer Entwurf.');
      attachments.push({ filename: 'entwurf-diagnose.json.txt', contentType: 'text/plain', content: Buffer.from(JSON.stringify(parsed.data)) });
    }
    const { images, snapshot, ...context } = report;
    const url = config.APP_ORIGIN + feedbackHash(report.page);
    const diagnostic = { ...context, version: config.APP_VERSION, url, workspace: me.workspace, sender: me.user, receivedAt: clock().toISOString() };
    attachments.unshift({ filename: 'feedback-kontext.json.txt', contentType: 'text/plain', content: Buffer.from(JSON.stringify(diagnostic, null, 2)) });
    const category = report.category === 'issue' ? 'Problem' : 'Verbesserung';
    try {
      await mail.send({
        to: config.FEEDBACK_TO_EMAIL!, replyTo: me.user.email,
        subject: `[StageHarbour] ${category} · ${feedbackPageLabel(report.page)}`,
        text: `${category}\n\n${report.message}\n\nVon: ${me.user.name} <${me.user.email}>\nArbeitsbereich: ${me.workspace.name}\nSeite: ${url}\nVersion: ${config.APP_VERSION}\nErfasst: ${report.capturedAt}\n\nArbeitskontext:\n${JSON.stringify(report.work ?? {}, null, 2)}\n\nBrowser: ${report.browser}\nAnsicht: ${report.viewport.width} × ${report.viewport.height}\n\nLetzte Aktivitäten:\n${JSON.stringify(report.activity ?? [], null, 2)}\n\n${snapshot ? 'Diagnoseentwurf angehängt; kann ungespeicherte Modelländerungen enthalten. Nicht übernommene Eingaben und Binärdateien sind nicht enthalten.' : 'Kein Entwurf angehängt.'}`,
        attachments,
      });
    } catch { throw new AccessError(503, 'Feedback konnte nicht versendet werden. Bitte erneut versuchen.'); }
    return { sent: true as const };
  });
}
