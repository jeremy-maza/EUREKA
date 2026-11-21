import type {
  AccessToken,
  AnswerResult,
  ChallengeAttempt,
  StartSessionResponse,
  UserProfile,
  WorldProgress,
  WorldSummary,
} from './types'

/** URL base de la API. Configurable con `VITE_API_URL` (ver `.env.example`). */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api').replace(/\/+$/, '')

/** Error de la API (o de red, con `status` 0) con un mensaje listo para mostrar al jugador. */
export class ApiError extends Error {
  status: number
  retryAfterSeconds?: number

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const TOKEN_KEY = 'eureka.token'

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token: string | null): void {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* almacenamiento no disponible: la sesión solo dura mientras la pestaña esté abierta */
    }
  },
}

/** Se invoca cuando el servidor rechaza el token (401) para que la app cierre la sesión local. */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

function describeError(status: number, body: unknown, retryAfter: number | undefined): string {
  const raw = (body as { message?: string | string[] } | null)?.message
  const text = Array.isArray(raw) ? raw.join(' ') : raw
  if (status === 429) {
    return `${text ?? 'Demasiados intentos.'}${retryAfter ? ` Vuelve a intentarlo en ${retryAfter} s.` : ''}`
  }
  return text || `Error inesperado del servidor (${status}).`
}

type RequestOptions = { body?: unknown; auth?: boolean }

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = options.auth === false ? null : tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.')
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized?.()
    const retryAfter = Number(response.headers.get('Retry-After')) || undefined
    throw new ApiError(response.status, describeError(response.status, data, retryAfter), retryAfter)
  }
  return data as T
}

export const api = {
  register: (body: { email: string; displayName: string; password: string }) =>
    request<UserProfile>('POST', '/auth/register', { body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<AccessToken>('POST', '/auth/login', { body, auth: false }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<UserProfile>('GET', '/users/me'),

  worlds: () => request<WorldSummary[]>('GET', '/worlds'),
  progress: () => request<WorldProgress[]>('GET', '/progress'),
  worldProgress: (slug: string) => request<WorldProgress>('GET', `/worlds/${slug}/progress`),

  startSession: (slug: string) => request<StartSessionResponse>('POST', `/worlds/${slug}/sessions`),
  startAttempt: (sessionId: string) => request<ChallengeAttempt>('POST', `/sessions/${sessionId}/attempts`),
  /** `null` si no hay reto abierto (p. ej. porque el servidor acaba de cerrarlo por tiempo). */
  async currentAttempt(sessionId: string): Promise<ChallengeAttempt | null> {
    try {
      return await request<ChallengeAttempt>('GET', `/sessions/${sessionId}/attempts/current`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  },
  answer: (attemptId: string, expression: string) =>
    request<AnswerResult>('POST', `/attempts/${attemptId}/answer`, { body: { expression } }),
}
