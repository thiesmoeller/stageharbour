export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function request(path: string, body?: unknown, method = 'POST'): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...(body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server. Bitte versuchen Sie es erneut.');
  }
  if (!response.ok) {
    if (response.status === 429) throw new ApiError(429, 'Zu viele Versuche. Bitte warten Sie eine Minute.');
    throw new ApiError(response.status, 'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.');
  }
  return response.json();
}
