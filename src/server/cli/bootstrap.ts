import { pathToFileURL } from 'node:url';
import { readConfig } from '../config.js';
import { connectDatabase } from '../db/connection.js';
import { bootstrapAdministrator } from '../identity/bootstrap.js';

export async function runBootstrap() {
  const config = readConfig();
  const { db, pool } = connectDatabase(config.DATABASE_URL);
  try {
    const result = await bootstrapAdministrator(db, config, {
      email: process.env.BOOTSTRAP_ADMIN_EMAIL,
      name: process.env.BOOTSTRAP_ADMIN_NAME,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    });
    console.log(result === 'created' ? 'Administrator und Arbeitsbereich angelegt.' : 'Bereits eingerichtet; keine Änderungen.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBootstrap();
}
