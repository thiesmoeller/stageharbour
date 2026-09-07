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
export const errorSchema = z.object({ message: z.string() });
export const loginOptionsSchema = z.object({ oidc: z.boolean() });
