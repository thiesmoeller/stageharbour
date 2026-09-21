import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

export type MailMessage = { to: string; subject: string; text: string };
export type MailTransport = { send(message: MailMessage): Promise<void> };

export type FakeMailTransport = MailTransport & {
  readonly messages: MailMessage[];
  failNext(count?: number): void;
  clear(): void;
};

export type SmtpMailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

export type MailTransportConfig = {
  NODE_ENV: string;
  MAIL_FROM?: string;
  MAIL_HOST?: string;
  MAIL_PORT?: number;
  MAIL_USER?: string;
  MAIL_PASS?: string;
  BREVO_API_KEY?: string;
};

type SmtpSender = {
  sendMail(mail: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
};

export function createFakeMailTransport(): FakeMailTransport {
  const messages: MailMessage[] = [];
  let failures = 0;
  return {
    messages,
    failNext(count = 1) { failures = count; },
    clear() { messages.length = 0; },
    async send(message) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('Versand fehlgeschlagen.');
      }
      messages.push({ ...message });
    },
  };
}

export function createBrevoTransport(options: { apiKey: string; from: string; fetch?: typeof fetch }): MailTransport {
  const sendHttp = options.fetch ?? fetch;
  return {
    async send(message) {
      const response = await sendHttp('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': options.apiKey, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'Bühnenplaner', email: options.from },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
        }),
      });
      if (!response.ok) throw new Error('Versand fehlgeschlagen.');
    },
  };
}

/** STARTTLS on 587 (Brevo default); SSL on 465. */
export function smtpTransportOptions(config: SmtpMailConfig): SMTPTransport.Options {
  const secure = config.port === 465;
  return {
    host: config.host,
    port: config.port,
    secure,
    requireTLS: !secure,
    auth: { user: config.user, pass: config.pass },
  };
}

export function createSmtpTransport(
  config: SmtpMailConfig,
  createSender: (options: SMTPTransport.Options) => SmtpSender = options => nodemailer.createTransport(options),
): MailTransport {
  const sender = createSender(smtpTransportOptions(config));
  return {
    async send(message) {
      try {
        await sender.sendMail({
          from: `Bühnenplaner <${config.from}>`,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
      } catch {
        throw new Error('Versand fehlgeschlagen.');
      }
    },
  };
}

function smtpConfigFrom(config: MailTransportConfig): SmtpMailConfig | undefined {
  const host = config.MAIL_HOST?.trim();
  const user = config.MAIL_USER?.trim();
  const pass = config.MAIL_PASS?.trim();
  const from = config.MAIL_FROM?.trim();
  if (!host && !user && !pass) return;
  if (!host || !user || !pass) {
    throw new Error('MAIL_HOST, MAIL_USER and MAIL_PASS are required together');
  }
  if (!from || !from.includes('@')) throw new Error('MAIL_FROM is required when SMTP is configured');
  return { host, port: config.MAIL_PORT ?? 587, user, pass, from };
}

export function createMailTransport(config: MailTransportConfig): MailTransport {
  const smtp = smtpConfigFrom(config);
  if (smtp) return createSmtpTransport(smtp);
  const apiKey = config.BREVO_API_KEY?.trim();
  const from = config.MAIL_FROM?.trim();
  if (apiKey) {
    if (!from || !from.includes('@')) throw new Error('MAIL_FROM is required when BREVO_API_KEY is set');
    return createBrevoTransport({ apiKey, from });
  }
  if (config.NODE_ENV === 'production') {
    return { async send() { throw new Error('E-Mail-Versand ist nicht konfiguriert.'); } };
  }
  return {
    async send(message) {
      console.info(`[mail] ${message.subject} -> ${message.to}\n${message.text}`);
    },
  };
}
