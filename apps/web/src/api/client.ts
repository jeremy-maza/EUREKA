import type {
  AccessToken,
  AnswerResult,
  AttemptHistoryPage,
  ChallengeAttempt,
  ScoreSummary,
  StartSessionResponse,
  UserProfile,
  WorldProgress,
} from './types';

/** Error de la API (o de red, con `status` 0) con un mensaje listo para mostrar al jugador. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'mbr.token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null): void {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* almacenamiento no disponible: la sesión solo dura mientras la pestaña esté abierta */
    }
  },
};

/** Se invoca cuando el servidor rechaza el token (401) para que la app cierre la sesión local. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

function describeError(status: number, body: unknown, retryAfter: number | undefined): string {
  const raw = (body as { message?: string | string[] } | null)?.message;
  const text = Array.isArray(raw) ? raw.join(' ') : raw;
  if (status === 429 && retryAfter) {
    return `${text ?? 'Demasiados intentos.'} Vuelve a intentarlo en ${retryAfter} s.`;
  }
  return text || `Error inesperado del servidor (${status}).`;
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = options.auth === false ? null : tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'No se pudo conectar con el servidor. Comprueba que la API esté en marcha.');
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized?.();
    const retryAfter = Number(response.headers.get('Retry-After')) || undefined;
    throw new ApiError(response.status, describeError(response.status, data, retryAfter), retryAfter);
  }
  return data as T;
}

export const api = {
  register: (body: { email: string; displayName: string; password: string }) =>
    request<UserProfile>('POST', '/auth/register', { body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<AccessToken>('POST', '/auth/login', { body, auth: false }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<UserProfile>('GET', '/users/me'),

  worldProgress: (slug: string) => request<WorldProgress>('GET', `/worlds/${slug}/progress`),
  worldScore: (slug: string, limit = 10) =>
    request<ScoreSummary>('GET', `/worlds/${slug}/score?limit=${limit}`),
  worldAttempts: (slug: string, limit = 10) =>
    request<AttemptHistoryPage>('GET', `/worlds/${slug}/attempts?limit=${limit}`),

  startSession: (slug: string) => request<StartSessionResponse>('POST', `/worlds/${slug}/sessions`),
  startAttempt: (sessionId: string) => request<ChallengeAttempt>('POST', `/sessions/${sessionId}/attempts`),
  /** `null` si no hay reto abierto (p. ej. porque el servidor acaba de cerrarlo por tiempo). */
  async currentAttempt(sessionId: string): Promise<ChallengeAttempt | null> {
    try {
      return await request<ChallengeAttempt>('GET', `/sessions/${sessionId}/attempts/current`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  answer: (attemptId: string, expression: string) =>
    request<AnswerResult>('POST', `/attempts/${attemptId}/answer`, { body: { expression } }),
};
