import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrevoTransport, createFakeMailTransport } from '../src/server/mail/transport.js';

const message = { to: 'editor@example.test', subject: 'Einladung', text: 'Bitte Konto einrichten: https://example.test/#/einladung/token' };

test('fake mail transport queues messages and retries after a failure', async () => {
  const mail = createFakeMailTransport();
  mail.failNext();
  await assert.rejects(mail.send(message), /Versand fehlgeschlagen/);
  assert.equal(mail.messages.length, 0);
  await mail.send(message);
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0]?.to, message.to);
  assert.equal(mail.messages[0]?.subject, message.subject);
  await mail.send({ ...message, to: 'admin@example.test', subject: 'Passwort zurücksetzen' });
  assert.equal(mail.messages[1]?.subject, 'Passwort zurücksetzen');
  assert.equal(mail.messages[1]?.to, 'admin@example.test');
});

test('Brevo adapter posts transactional mail and surfaces HTTP failures', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mail = createBrevoTransport({
    apiKey: 'test-brevo-key',
    from: 'planer@example.test',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('ok', { status: calls.length === 1 ? 201 : 500 });
    },
  });
  await mail.send(message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal((calls[0]?.init.headers as Record<string, string>)['api-key'], 'test-brevo-key');
  const body = JSON.parse(String(calls[0]?.init.body));
  assert.equal(body.sender.email, 'planer@example.test');
  assert.deepEqual(body.to, [{ email: message.to }]);
  assert.equal(body.subject, message.subject);
  assert.equal(body.textContent, message.text);
  await assert.rejects(mail.send(message), /Versand fehlgeschlagen/);
});
