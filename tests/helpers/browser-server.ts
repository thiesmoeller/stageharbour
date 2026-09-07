import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import { testAdministrator, testDatabase, testEditor } from './database.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { createApp } from '../../src/server/app.js';
import { account, membership, user } from '../../src/server/db/schema.js';

const fixture = await testDatabase('http://127.0.0.1:4173');
await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
const editorId = randomUUID();
await fixture.db.insert(user).values({ id: editorId, name: testEditor.name, email: testEditor.email });
await fixture.db.insert(account).values({ id: randomUUID(), userId: editorId, accountId: editorId, providerId: 'credential', password: await hashPassword(testEditor.password) });
await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: editorId, role: 'editor' });
const app = await createApp(fixture.db, fixture.config, { staticRoot: resolve('dist/web') });
app.addHook('onClose', fixture.dispose);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port: 4173 });
