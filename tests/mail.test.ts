import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBrevoTransport, createFakeMailTransport, createMailTransport, createSmtpTransport, smtpTransportOptions,
} from '../src/server/mail/transport.js';

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

test('SMTP options use STARTTLS on 587 and SSL on 465', () => {
  const starttls = smtpTransportOptions({
    host: 'smtp-relay.brevo.com', port: 587, user: 'login@example.test', pass: 'smtp-key', from: 'planer@example.test',
  });
  assert.equal(starttls.host, 'smtp-relay.brevo.com');
  assert.equal(starttls.port, 587);
  assert.equal(starttls.secure, false);
  assert.equal(starttls.requireTLS, true);
  assert.deepEqual(starttls.auth, { user: 'login@example.test', pass: 'smtp-key' });

  const ssl = smtpTransportOptions({
    host: 'smtp-relay.brevo.com', port: 465, user: 'login@example.test', pass: 'smtp-key', from: 'planer@example.test',
  });
  assert.equal(ssl.secure, true);
  assert.equal(ssl.requireTLS, false);
});

test('SMTP transport sends via injected sender and maps failures', async () => {
  const sent: Array<{ from: string; to: string; subject: string; text: string }> = [];
  const mail = createSmtpTransport(
    { host: 'smtp-relay.brevo.com', port: 587, user: 'login@example.test', pass: 'smtp-key', from: 'planer@example.test' },
    () => ({
      async sendMail(mailOptions) {
        if (sent.length > 0) throw new Error('relay down');
        sent.push(mailOptions);
      },
    }),
  );
  await mail.send(message);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.from, 'Bühnenplaner <planer@example.test>');
  assert.equal(sent[0]?.to, message.to);
  assert.equal(sent[0]?.subject, message.subject);
  assert.equal(sent[0]?.text, message.text);
  await assert.rejects(mail.send(message), /Versand fehlgeschlagen/);
});

test('createMailTransport prefers SMTP over Brevo API and defaults port 587', async () => {
  assert.throws(() => createMailTransport({
    NODE_ENV: 'production',
    MAIL_HOST: 'smtp-relay.brevo.com',
    MAIL_USER: 'login@example.test',
    MAIL_FROM: 'planer@example.test',
    BREVO_API_KEY: 'unused-api-key',
  }), /MAIL_HOST, MAIL_USER and MAIL_PASS/);

  assert.throws(() => createMailTransport({
    NODE_ENV: 'production',
    MAIL_HOST: 'smtp-relay.brevo.com', MAIL_USER: 'login@example.test', MAIL_PASS: 'smtp-key',
  }), /MAIL_FROM/);

  const options = smtpTransportOptions({
    host: 'smtp-relay.brevo.com', port: 587, user: 'u', pass: 'p', from: 'planer@example.test',
  });
  assert.equal(options.port, 587);

  const unconfigured = createMailTransport({ NODE_ENV: 'production' });
  await assert.rejects(unconfigured.send(message), /nicht konfiguriert/);
});

test('feedback reply-to and attachment bytes survive SMTP and Brevo delivery', async () => {
  const feedback = { ...message, replyTo: 'reporter@example.test', attachments: [{ filename: 'context.json.txt', contentType: 'text/plain', content: Buffer.from('{"view":"plan"}') }] };
  const smtp = createSmtpTransport(
    { host: 'smtp.example.test', port: 587, user: 'u', pass: 'p', from: 'app@example.test' },
    () => ({ async sendMail(options) {
      assert.equal(options.replyTo, feedback.replyTo);
      assert.deepEqual(options.attachments, feedback.attachments);
    } }),
  );
  await smtp.send(feedback);
  const brevo = createBrevoTransport({ apiKey: 'test', from: 'app@example.test', fetch: async (_, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.replyTo, { email: feedback.replyTo });
    assert.deepEqual(body.attachment, [{ name: 'context.json.txt', content: feedback.attachments[0]!.content.toString('base64') }]);
    return new Response('{}', { status: 201 });
  } });
  await brevo.send(feedback);
});
