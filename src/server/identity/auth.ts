import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins';
import { oidcEnabled, type Config } from '../config.js';
import type { Database } from '../db/connection.js';
import * as schema from '../db/schema.js';

export const pocketIdProvider = 'pocket-id';

export function createAuth(db: Database, config: Config, options: { rateLimit?: boolean } = {}) {
  return betterAuth({
    appName: 'Bühnenplaner',
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    baseURL: config.APP_ORIGIN,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_ORIGIN],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    account: { accountLinking: { enabled: true, disableImplicitLinking: true, trustedProviders: [pocketIdProvider] } },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: config.APP_ORIGIN.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['x-stage-client-ip'] },
    },
    rateLimit: { enabled: options.rateLimit ?? true, window: 60, max: 60, customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-in/social': { window: 60, max: 10 },
    } },
    plugins: oidcEnabled(config) ? [genericOAuth({ config: [{
      providerId: pocketIdProvider,
      clientId: config.OIDC_CLIENT_ID,
      clientSecret: config.OIDC_CLIENT_SECRET,
      discoveryUrl: `${config.OIDC_ISSUER.replace(/\/$/, '')}/.well-known/openid-configuration`,
      redirectURI: config.OIDC_REDIRECT_URI ?? `${config.APP_ORIGIN}/api/auth/callback/${pocketIdProvider}`,
      scopes: ['openid', 'email', 'profile'],
      pkce: true,
      requireIdTokenVerification: true,
      disableProviderLogout: true,
    }] })] : [],
  });
}
export type Auth = ReturnType<typeof createAuth>;
