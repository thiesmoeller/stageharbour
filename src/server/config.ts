import { z } from 'zod';

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
  MAIL_FROM: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
});
export type Config = z.infer<typeof schema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Never print configuration values (database credentials and signing secret).
    throw new Error(`Invalid configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.APP_ORIGIN.startsWith('https://')) {
    throw new Error('APP_ORIGIN must use HTTPS in production');
  }
  return parsed.data;
}
