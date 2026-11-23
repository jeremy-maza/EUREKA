import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '@/services/storage/token-store';
import { api, ApiError, API_URL, setUnauthorizedHandler } from './client';

function reply(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

const lastInit = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
const lastHeaders = (fetchMock: ReturnType<typeof vi.fn>) =>
  lastInit(fetchMock).headers as Record<string, string>;

beforeEach(() => localStorage.clear());
afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('autenticación de las peticiones', () => {
  it('envía el token guardado como Bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, []));
    vi.stubGlobal('fetch', fetchMock);
    tokenStore.set('tok');

    await api.worlds();

    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/worlds`);
    expect(lastHeaders(fetchMock).Authorization).toBe('Bearer tok');
  });

  it('el registro y el acceso no llevan token aunque haya uno guardado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { accessToken: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    tokenStore.set('viejo');

    await api.login({ email: 'ana@example.com', password: 'una-clave-larga' });

    expect(lastHeaders(fetchMock).Authorization).toBeUndefined();
    expect(lastHeaders(fetchMock)['Content-Type']).toBe('application/json');
    expect(lastInit(fetchMock).body).toBe(
      JSON.stringify({ email: 'ana@example.com', password: 'una-clave-larga' }),
    );
  });

  it('un 401 con token llama al manejador de sesión caducada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(401, { message: 'Token inválido.' })));
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    tokenStore.set('tok');

    await expect(api.me()).rejects.toMatchObject({ status: 401, message: 'Token inválido.' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('un 401 sin token (credenciales erróneas al entrar) no se trata como sesión caducada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(401, { message: 'Credenciales inválidas.' })));
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    await expect(api.login({ email: 'a@b.c', password: 'x' })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('el almacén del token no falla si el navegador bloquea el almacenamiento', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });

    expect(tokenStore.get()).toBeNull();
    expect(() => tokenStore.set('tok')).not.toThrow();
  });
});

describe('errores', () => {
  it('un fallo de red es un ApiError con estado 0 y un mensaje para el jugador', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await api.worlds().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0 });
    expect((error as ApiError).message).toMatch(/No se pudo conectar con el servidor/);
  });

  it('un 429 añade cuánto esperar según Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply(429, { message: 'Demasiados intentos.' }, { 'Retry-After': '30' })),
    );

    await expect(api.login({ email: 'a@b.c', password: 'x' })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
      message: 'Demasiados intentos. Vuelve a intentarlo en 30 s.',
    });
  });

  it('une los mensajes de validación cuando el servidor devuelve una lista', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply(400, { message: ['email must be an email', 'password is too short'] })),
    );

    await expect(api.register({ email: 'x', displayName: 'A', password: 'y' })).rejects.toMatchObject({
      message: 'email must be an email password is too short',
    });
  });

  it('una respuesta de error que no es JSON usa un mensaje genérico con el estado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(502, '<html>Bad gateway</html>')));

    await expect(api.worlds()).rejects.toMatchObject({
      status: 502,
      message: 'Error inesperado del servidor (502).',
    });
  });

  it('una respuesta correcta sin cuerpo (204) no falla', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(204)));
    await expect(api.logout()).resolves.toBeNull();
  });
});

describe('reto en curso', () => {
  it('devuelve null si el servidor ya cerró el reto (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, { message: 'No hay un reto en curso.' })));
    await expect(api.currentAttempt('s1')).resolves.toBeNull();
  });

  it('propaga los demás errores', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(500, { message: 'Error interno del servidor.' })));
    await expect(api.currentAttempt('s1')).rejects.toMatchObject({ status: 500 });
  });
});

describe('rutas del progreso del jugador', () => {
  it('pide puntos e historial con el límite indicado', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(reply(200, {})));
    vi.stubGlobal('fetch', fetchMock);

    await api.worldScore('arithmetic', 5);
    await api.worldAttempts('arithmetic', 10);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${API_URL}/worlds/arithmetic/score?limit=5`,
      `${API_URL}/worlds/arithmetic/attempts?limit=10`,
    ]);
  });
});
