export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function request(path: string, body?: unknown, method?: string): Promise<unknown> {
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
    throw new ApiError(0, 'Keine Verbindung zum Server. Bitte versuchen Sie es erneut.');
  }
  if (!response.ok) {
    if (response.status === 429) throw new ApiError(429, 'Zu viele Versuche. Bitte warten Sie eine Minute.');
    throw new ApiError(response.status, 'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.');
  }
  return response.json();
}
