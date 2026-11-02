export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(3000),
  });
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await request(path, { signal });
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
  return (await response.json()) as T;
}

export async function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

export function safeApiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 429)
    return 'Muitas tentativas. Aguarde um minuto e tente novamente.';
  return fallback;
}
