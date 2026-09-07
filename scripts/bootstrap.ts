import { readConfig } from '../src/server/config.js';
import { connectDatabase } from '../src/server/db/connection.js';
import { bootstrapAdministrator } from '../src/server/identity/bootstrap.js';

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
