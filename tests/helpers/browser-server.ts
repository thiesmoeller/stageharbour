import { resolve } from 'node:path';
import { testAdministrator, testDatabase } from './database.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { createApp } from '../../src/server/app.js';

const fixture = await testDatabase('http://127.0.0.1:4173');
await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
const app = await createApp(fixture.db, fixture.config, { staticRoot: resolve('dist/web') });
app.addHook('onClose', fixture.dispose);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port: 4173 });
