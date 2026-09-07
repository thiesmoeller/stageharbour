export type MailMessage = { to: string; subject: string; text: string };
export type MailTransport = { send(message: MailMessage): Promise<void> };

export type FakeMailTransport = MailTransport & {
  readonly messages: MailMessage[];
  failNext(count?: number): void;
  clear(): void;
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

export function createMailTransport(config: { NODE_ENV: string; BREVO_API_KEY?: string; MAIL_FROM?: string }): MailTransport {
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
