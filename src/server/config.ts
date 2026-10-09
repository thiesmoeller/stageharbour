import { z } from 'zod';
import { resolveAppVersion } from '../shared/appVersion.js';

const blank = (value: unknown) => value === '' ? undefined : value;
const optionalUrl = z.preprocess(blank, z.url().optional());
const optionalSecret = z.preprocess(blank, z.string().min(1).optional());

const schema = z.object({
  DATABASE_URL: z.url().refine(value => /^postgres(ql)?:/.test(value)),
  APP_ORIGIN: z.url().refine(value => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  }, 'Use an HTTP(S) origin without a path or trailing slash'),
  BETTER_AUTH_SECRET: z.string().min(32),
  WORKSPACE_ID: z.uuid(),
  WORKSPACE_NAME: z.string().trim().min(1).max(120),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OIDC_ISSUER: optionalUrl,
  OIDC_CLIENT_ID: optionalSecret,
  OIDC_CLIENT_SECRET: optionalSecret,
  OIDC_REDIRECT_URI: optionalUrl,
  FEEDBACK_TO_EMAIL: z.preprocess(blank, z.email().optional()),
  MAIL_FROM: z.preprocess(blank, z.string().optional()),
  MAIL_HOST: z.preprocess(blank, z.string().min(1).optional()),
  MAIL_PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65535).optional()),
  MAIL_USER: z.preprocess(blank, z.string().min(1).optional()),
  MAIL_PASS: z.preprocess(blank, z.string().min(1).optional()),
  BREVO_API_KEY: z.preprocess(blank, z.string().min(1).optional()),
  STORAGE_DIR: z.string().min(1).default('data/storage'),
  /** Build/release id from `git describe` (set in CI/Docker; otherwise resolved from git). */
  APP_VERSION: z.string().trim().min(1).max(120),
});
export type Config = z.infer<typeof schema>;

export function oidcEnabled(config: Config): config is Config & {
  OIDC_ISSUER: string; OIDC_CLIENT_ID: string; OIDC_CLIENT_SECRET: string;
} {
  return Boolean(config.OIDC_ISSUER && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse({ ...env, APP_VERSION: resolveAppVersion(env) });
  if (!parsed.success) {
    // Never print configuration values (database credentials and signing secret).
    throw new Error(`Invalid configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.APP_ORIGIN.startsWith('https://')) {
    throw new Error('APP_ORIGIN must use HTTPS in production');
  }
  const oidc = [parsed.data.OIDC_ISSUER, parsed.data.OIDC_CLIENT_ID, parsed.data.OIDC_CLIENT_SECRET];
  const present = oidc.filter(value => value !== undefined).length;
  if ((present !== 0 && present !== 3) || (parsed.data.OIDC_REDIRECT_URI && present !== 3)) {
    throw new Error('Invalid configuration: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET');
  }
  return parsed.data;
}
