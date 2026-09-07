import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { testAdministrator, testDatabase } from './database.js';
import { mailboxPath } from './mailbox.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { createApp } from '../../src/server/app.js';
import { createFakeMailTransport } from '../../src/server/mail/transport.js';
const mail = createFakeMailTransport();
const fixture = await testDatabase('http://127.0.0.1:4173');
await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
const app = await createApp(fixture.db, fixture.config, {
  staticRoot: resolve('dist/web'),
  mail: {
    async send(message) {
      await mail.send(message);
      await mkdir('test-results', { recursive: true });
      await writeFile(mailboxPath, JSON.stringify(mail.messages));
    },
  },
});
app.addHook('onClose', fixture.dispose);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port: 4173 });
