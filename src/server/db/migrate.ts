import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connectDatabase, type Database } from './connection.js';

export async function migrateDatabase(db: Database) {
  await migrate(db, { migrationsFolder: 'drizzle' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { db, pool } = connectDatabase(process.env.DATABASE_URL);
  try {
    await migrateDatabase(db);
    console.log('Database migrations applied.');
  } finally {
    await pool.end();
  }
}
