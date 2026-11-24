import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arithmeticWorld,
  mockApi,
  ok,
  progress,
  renderApp,
  signIn,
  student,
  teacher,
  TOKEN_KEY,
} from '@/test/utils';

const token = { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600 };
const homeData = {
  'GET /worlds': () => ok([arithmeticWorld]),
  'GET /progress': () => ok([progress()]),
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('rutas protegidas', () => {
  it('sin sesión, una ruta privada redirige al acceso', async () => {
    const api = mockApi({});
    renderApp('/juego');

    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/acceso');
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('con sesión guardada válida, restaura al jugador sin pedir credenciales', async () => {
    signIn();
    const api = mockApi({ 'GET /users/me': () => ok(student), ...homeData });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
    expect(api.lastAuthorization()).toBe('Bearer tok');
  });

  it('si el servidor rechaza el token guardado, cierra la sesión local y avisa de que expiró', async () => {
    signIn('caducado');
    mockApi({ 'GET /users/me': () => ({ status: 401, body: { message: 'Token inválido.' } }) });
    renderApp('/');

    expect(await screen.findByText('Tu sesión expiró. Inicia sesión de nuevo.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/acceso');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('un jugador ya autenticado que abre /acceso va a la pantalla de inicio', async () => {
    signIn();
    mockApi({ 'GET /users/me': () => ok(student), ...homeData });
    renderApp('/acceso');

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('un docente que abre una ruta de estudiante termina en su panel, sin iniciar ninguna partida', async () => {
    signIn();
    const api = mockApi({
      'GET /users/me': () => ok(teacher),
      'GET /teacher/dashboard': () => ({ status: 500, body: { message: 'Panel no disponible.' } }),
    });
    renderApp('/juego');

    expect(await screen.findByText('No pudimos cargar tu panel')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/docente');
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(0);
  });

  it('un estudiante que abre el panel docente vuelve al inicio', async () => {
    signIn();
    const api = mockApi({ 'GET /users/me': () => ok(student), ...homeData });
    renderApp('/docente');

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(api.count('GET /teacher/dashboard')).toBe(0);
  });

  it('una ruta desconocida redirige al inicio', async () => {
    signIn();
    mockApi({ 'GET /users/me': () => ok(student), ...homeData });
    renderApp('/no-existe');

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});

describe('registro', () => {
  it('crea la cuenta, inicia sesión, guarda el token y entra al inicio', async () => {
    const api = mockApi({
      'POST /auth/register': () => ({ status: 201, body: student }),
      'POST /auth/login': () => ok(token),
      'GET /users/me': () => ok(student),
      ...homeData,
    });
    renderApp('/registro');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
    expect(api.bodies('POST /auth/register')).toEqual([
      { email: 'ana@example.com', displayName: 'Ana', password: 'correct-horse-battery' },
    ]);
    // Tras el registro entra con las mismas credenciales.
    expect(api.bodies('POST /auth/login')).toEqual([
      { email: 'ana@example.com', password: 'correct-horse-battery' },
    ]);
  });

  it('valida el formulario en el cliente sin llamar a la API', async () => {
    const api = mockApi({});
    renderApp('/registro');

    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe tu nombre.');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'corta');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByRole('alert')).toHaveTextContent('al menos 8 caracteres');

    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('muestra el error del servidor (correo ya registrado) y no inicia sesión', async () => {
    mockApi({
      'POST /auth/register': () => ({ status: 409, body: { message: 'Ese correo ya está registrado.' } }),
    });
    renderApp('/registro');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ese correo ya está registrado.');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/registro');
  });
});

describe('acceso', () => {
  it('inicia sesión y vuelve a la ruta que se intentó abrir', async () => {
    mockApi({
      'POST /auth/login': () => ok(token),
      'GET /users/me': () => ok(student),
      ...homeData,
    });
    renderApp('/');

    // Sin sesión, `/` redirige al acceso.
    await userEvent.type(await screen.findByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
  });

  it('muestra el error de credenciales inválidas y no guarda ningún token', async () => {
    mockApi({
      'POST /auth/login': () => ({
        status: 401,
        body: { statusCode: 401, message: 'Credenciales inválidas.' },
      }),
    });
    renderApp('/acceso');

    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala-clave-123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas.');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    // El 401 de un intento de login no es una "sesión caducada".
    expect(screen.queryByText(/Tu sesión expiró/)).not.toBeInTheDocument();
  });

  it('explica cuánto esperar cuando el servidor limita los intentos (429)', async () => {
    mockApi({
      'POST /auth/login': () => ({
        status: 429,
        headers: { 'Retry-After': '45' },
        body: { message: 'Demasiados intentos.' },
      }),
    });
    renderApp('/acceso');

    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala-clave-123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Demasiados intentos. Vuelve a intentarlo en 45 s.',
    );
  });

  it('avisa si no hay conexión con el servidor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    renderApp('/acceso');

    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala-clave-123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor');
  });

  it('exige correo y contraseña antes de llamar a la API', async () => {
    const api = mockApi({});
    renderApp('/acceso');

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe tu correo electrónico.');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe tu contraseña.');
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('cerrar sesión revoca la sesión en el servidor, borra el token y vuelve al acceso', async () => {
    signIn();
    const api = mockApi({
      'GET /users/me': () => ok(student),
      'POST /auth/logout': () => ({ status: 204 }),
      ...homeData,
    });
    renderApp('/');

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(api.count('POST /auth/logout')).toBe(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('cierra la sesión local aunque el servidor no responda al cerrarla', async () => {
    signIn();
    mockApi({
      'GET /users/me': () => ok(student),
      'POST /auth/logout': () => ({ status: 500, body: { message: 'Error.' } }),
      ...homeData,
    });
    renderApp('/');

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
