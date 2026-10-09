import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import { testAdministrator, testDatabase, testEditor } from './database.js';
import { mailboxPath } from './mailbox.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { createAuth } from '../../src/server/identity/auth.js';
import { createApp } from '../../src/server/app.js';
import { account, membership, user } from '../../src/server/db/schema.js';
import { createFakeMailTransport } from '../../src/server/mail/transport.js';
import type { SurfaceCatalogClient } from '../../src/server/surfaces/polyHaven.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const catalogItem = {
  id: 'theatre_wood',
  name: 'Theatre Wood',
  description: 'CC0 theatre wood fixture',
  thumbnailUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/theatre_wood.png',
  categories: ['wood'],
  tileWidthMm: 2000,
  tileHeightMm: 1000,
};
const surfaceCatalog: SurfaceCatalogClient = {
  async search(query) { return query && !'theatre wood'.includes(query.toLowerCase()) ? [] : [catalogItem]; },
  async download() {
    return {
      item: catalogItem,
      maps: {
        baseColor: { bytes: onePixelPng, mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1 },
        orm: { bytes: onePixelPng, mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1 },
      },
    };
  },
};

const mail = createFakeMailTransport();
const fixture = await testDatabase('http://127.0.0.1:4173', { FEEDBACK_TO_EMAIL: 'maintainer@example.test' });
await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
const editorId = randomUUID();
await fixture.db.insert(user).values({ id: editorId, name: testEditor.name, email: testEditor.email });
await fixture.db.insert(account).values({ id: randomUUID(), userId: editorId, accountId: editorId, providerId: 'credential', password: await hashPassword(testEditor.password) });
await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: editorId, role: 'editor' });
const app = await createApp(fixture.db, fixture.config, {
  // Browser journeys share an IP. Rate-limit enforcement has its own integration tests.
  auth: createAuth(fixture.db, fixture.config, { rateLimit: false }),
  staticRoot: resolve('dist/web'),
  surfaceCatalog,
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
