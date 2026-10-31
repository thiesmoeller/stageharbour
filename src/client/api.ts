import { recordApiFailure } from './feedback/activity.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function failure(status: number): never {
  if (status === 429) throw new ApiError(429, 'Zu viele Versuche. Bitte warten Sie eine Minute.');
  throw new ApiError(status, 'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.');
}

export type ApiTransport = {
  request(path: string, body?: unknown, method?: string): Promise<unknown>;
  upload(path: string, file: File): Promise<unknown>;
  getBlob(path: string): Promise<Blob>;
};

const fetchTransport: ApiTransport = {
  async request(path, body?, method?) {
    let response: Response;
    try {
      const init: RequestInit = { credentials: 'same-origin' };
      if (body !== undefined) {
        init.method = method ?? 'POST';
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      } else if (method) {
        init.method = method;
      }
      response = await fetch(path, init);
    } catch {
      recordApiFailure(path, 0);
      throw new ApiError(0, 'Keine Verbindung zum Server. Bitte versuchen Sie es erneut.');
    }
    if (!response.ok) {
      recordApiFailure(path, response.status);
      const payload = await response.json().catch(() => undefined) as { message?: unknown } | undefined;
      if (typeof payload?.message === 'string' && payload.message.trim()) throw new ApiError(response.status, payload.message);
      failure(response.status);
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  },

  async upload(path, file) {
    const type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf'
      : file.name.toLowerCase().endsWith('.png') ? 'image/png'
      : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : 'application/octet-stream');
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': type, 'x-file-name': file.name },
        body: file,
      });
    } catch {
      recordApiFailure(path, 0);
      throw new ApiError(0, 'Keine Verbindung zum Server. Bitte versuchen Sie es erneut.');
    }
    if (!response.ok) { recordApiFailure(path, response.status); failure(response.status); }
    return response.json();
  },

  async getBlob(path) {
    let response: Response;
    try {
      response = await fetch(path, { credentials: 'same-origin' });
    } catch {
      recordApiFailure(path, 0);
      throw new ApiError(0, 'Keine Verbindung zum Server. Bitte versuchen Sie es erneut.');
    }
    if (!response.ok) { recordApiFailure(path, response.status); failure(response.status); }
    return response.blob();
  },
};

let transport: ApiTransport = fetchTransport;

export function setApiTransport(next: ApiTransport): void {
  transport = next;
}

export function getApiTransport(): ApiTransport {
  return transport;
}

export function request(path: string, body?: unknown, method?: string): Promise<unknown> {
  return transport.request(path, body, method);
}

export function upload(path: string, file: File): Promise<unknown> {
  return transport.upload(path, file);
}

export function getBlob(path: string): Promise<Blob> {
  return transport.getBlob(path);
}
