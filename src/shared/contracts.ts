import { z } from 'zod';

export const roleSchema = z.enum(['administrator', 'editor', 'viewer']);
export type Role = z.infer<typeof roleSchema>;
export const workspaceParamsSchema = z.object({ workspaceId: z.uuid() });
export const workspaceSchema = z.object({ id: z.uuid(), name: z.string(), role: roleSchema });
export const meSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.email() }),
  workspace: workspaceSchema,
});
export type Me = z.infer<typeof meSchema>;
export const memberSchema = z.object({ userId: z.string(), name: z.string(), email: z.email(), role: roleSchema });
export const membersSchema = z.array(memberSchema);
export type Member = z.infer<typeof memberSchema>;
export const memberParamsSchema = workspaceParamsSchema.extend({ userId: z.string().min(1).max(128) });
export const inviteMemberSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(120),
  role: roleSchema,
});
export const invitationSchema = z.object({ email: z.email(), name: z.string(), role: roleSchema });
export const invitationPreviewSchema = invitationSchema.extend({ workspaceName: z.string() });
export const acceptInvitationSchema = z.object({}).strict();
export const tokenParamsSchema = z.object({ token: z.string().min(16).max(128) });
export const changeRoleSchema = z.object({ role: roleSchema });
export const requestPasswordResetSchema = z.object({ email: z.email() });
export const completePasswordResetSchema = z.object({ password: z.string().min(12).max(128) });
export const passwordResetPreviewSchema = z.object({ email: z.email() });
export const okSchema = z.object({ ok: z.literal(true) });
export const acceptInvitationResultSchema = z.object({
  ok: z.literal(true),
  user: z.object({ id: z.string(), name: z.string(), email: z.email() }),
});
export const errorSchema = z.object({ message: z.string() });
export const venueReferenceSchema = z.object({
  id: z.uuid(), kind: z.enum(['image', 'pdf']), mediaType: z.string(),
  originalName: z.string(), pageCount: z.number().int().nullable(),
  pixelWidth: z.number().int().nullable(), pixelHeight: z.number().int().nullable(),
});
export type VenueReference = z.infer<typeof venueReferenceSchema>;
export const loginOptionsSchema = z.object({
  oidc: z.boolean(),
  version: z.string().min(1).max(120),
});
export const brandingSchema = z.object({
  productName: z.string().min(1).max(80),
  tagline: z.string().max(120),
  footerText: z.string().max(200),
  hasLogo: z.boolean(),
});
export type Branding = z.infer<typeof brandingSchema>;
export const updateBrandingSchema = z.object({
  productName: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(120),
  footerText: z.string().trim().max(200),
});
export const DEFAULT_BRANDING = {
  productName: 'StageHarbour',
  tagline: 'GEMEINSAM THEATER MACHEN',
  footerText: 'Für die Bühne. Für die Menschen dahinter.',
  hasLogo: false,
} as const satisfies Branding;
