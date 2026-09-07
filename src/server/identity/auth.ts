import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Config } from '../config.js';
import type { Database } from '../db/connection.js';
import * as schema from '../db/schema.js';

export function createAuth(db: Database, config: Config) {
  return betterAuth({
    appName: 'Bühnenplaner',
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    baseURL: config.APP_ORIGIN,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_ORIGIN],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: config.APP_ORIGIN.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['x-stage-client-ip'] },
    },
    rateLimit: { enabled: true, window: 60, max: 60, customRules: {
      '/sign-in/email': { window: 60, max: 10 },
    } },
  });
}
export type Auth = ReturnType<typeof createAuth>;
