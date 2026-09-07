import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../src/server/db/schema.js';
import { readConfig } from '../../src/server/config.js';

export const testAdministrator = { email: 'admin@example.test', name: 'Test Administration', password: 'test-only-password-7319' };
export const testEditor = { email: 'editor@example.test', name: 'Zweite Bearbeitung', password: 'test-only-password-7319' };

export async function testDatabase(origin = 'http://localhost:5173', extra: NodeJS.ProcessEnv = {}) {
  // A separate database also isolates migrations' public-qualified enum names.
  const databaseName = `stage_test_${randomUUID().replaceAll('-', '')}`;
  const connectionString = process.env.TEST_DATABASE_URL ?? 'postgresql://stage_planner:local-development-only@127.0.0.1:55432/stage_planner';
  const control = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  await control.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  const pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  const db = drizzle(pool, { schema });
  const config = readConfig({
    DATABASE_URL: url.href, APP_ORIGIN: origin, NODE_ENV: 'test',
    BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
    WORKSPACE_ID: randomUUID(), WORKSPACE_NAME: 'Beispiel-Theatergruppe',
    ...extra,
  });
  const dispose = async () => {
    await pool.end();
    try { await control.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
    finally { await control.end(); }
  };
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    // A second application must be a no-op.
    await migrate(db, { migrationsFolder: 'drizzle' });
  } catch (error) { await dispose(); throw error; }
  return { db, pool, config, dispose };
}
