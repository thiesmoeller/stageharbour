import { execSync } from 'node:child_process';

/** Prefer APP_VERSION (CI/Docker); otherwise git describe --tags --always --dirty. */
export function resolveAppVersion(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync('git describe --tags --always --dirty', {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'dev';
  } catch {
    return 'dev';
  }
}
