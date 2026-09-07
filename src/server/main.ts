import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { connectDatabase } from './db/connection.js';

const config = readConfig();
const { db, pool } = connectDatabase(config.DATABASE_URL);
const app = await createApp(db, config, {
  logger: true,
  ...(config.NODE_ENV === 'production' ? { staticRoot: fileURLToPath(new URL('../web', import.meta.url)) } : {}),
});
app.addHook('onClose', async () => { await pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close(); });
}
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch {
  console.error('Server konnte nicht gestartet werden. Adresse und Konfiguration prüfen.');
  await app.close();
  process.exitCode = 1;
}
