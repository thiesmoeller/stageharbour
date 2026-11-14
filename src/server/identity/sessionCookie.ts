import { getCookies } from 'better-auth/cookies';
import { serializeSignedCookie } from 'better-call';
import type { FastifyReply } from 'fastify';
import type { Auth } from './auth.js';

/** Create a Better Auth session for `userId` and attach the signed session cookie to `reply`. */
export async function attachSessionCookie(auth: Auth, userId: string, reply: FastifyReply) {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  if (!session) throw new Error('Session could not be created');
  const cookies = getCookies(ctx.options);
  const cookie = await serializeSignedCookie(
    cookies.sessionToken.name,
    session.token,
    ctx.secret,
    { ...cookies.sessionToken.attributes, maxAge: ctx.sessionConfig.expiresIn },
  );
  const existing = reply.getHeader('set-cookie');
  if (!existing) reply.header('set-cookie', cookie);
  else if (Array.isArray(existing)) reply.header('set-cookie', [...existing.map(String), cookie]);
  else reply.header('set-cookie', [String(existing), cookie]);
  return session;
}
