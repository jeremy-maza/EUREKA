import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerResult, ChallengeAttempt, WorldProgress } from './api/types';
import { routes } from './routes';

const rule2 = { key: 'r2', type: 'FORBIDDEN_DIGIT', description: 'No puedes usar el dígito 2.' };

function progress(over: Partial<WorldProgress> = {}): WorldProgress {
  return {
    worldSlug: 'arithmetic',
    status: 'IN_PROGRESS',
    currentPosition: 1,
    challengeCount: 4,
    streak: 0,
    bestStreak: 0,
    totalPoints: 0,
    nextMultiplierMilli: 1000,
    nextMultiplier: '1',
    unlockedRules: [],
    activeSessionId: null,
    pendingAttemptId: null,
    statistics: {
      attemptsCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      timeoutCount: 0,
      averageCorrectElapsedMs: null,
      ruleViolationCounts: {},
    },
    ...over,
  };
}

function attempt(over: Partial<ChallengeAttempt> = {}): ChallengeAttempt {
  return {
    attemptId: 'a1',
    sessionId: 's1',
    worldSlug: 'arithmetic',
    position: 1,
    challengeCount: 4,
    expression: '3 * 7',
    rules: [],
    newRule: null,
    timeLimitSeconds: 60,
    startedAt: '',
    deadlineAt: '',
    serverTime: '',
    remainingMs: 60_000,
    resumed: false,
    expiredAttempt: null,
    ...over,
  };
}

function answer(over: Partial<AnswerResult>): AnswerResult {
  return {
    attemptId: 'a1',
    outcome: 'CORRECT',
    failureReason: null,
    message: '¡Correcto!',
    evaluatedValue: '21',
    violations: [],
    score: { basePoints: 100, multiplierMilli: 1000, multiplier: '1', points: 100 },
    unlockedRule: null,
    sequenceRestarted: false,
    worldCompleted: false,
    progress: progress({ totalPoints: 100, streak: 1, nextMultiplier: '1.5' }),
    replayed: false,
    ...over,
  };
}

type Handler = (body: unknown) => { status?: number; body?: unknown };

/** API simulada: ruta "MÉTODO /ruta" → respuesta. */
function mockApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = handlers[key];
    if (!handler) return Promise.reject(new Error(`sin handler para ${key}`));
    const { status = 200, body } = handler(init?.body ? JSON.parse(String(init.body)) : undefined);
    const text = body === undefined ? '' : JSON.stringify(body);
    return Promise.resolve(new Response(text, { status, headers: { 'content-type': 'application/json' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

const me = { id: 'u1', email: 'ana@example.com', displayName: 'Ana', role: 'STUDENT' };

describe('autenticación', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('una ruta de juego sin sesión redirige al login', async () => {
    mockApi({});
    renderAt('/mundos/arithmetic/jugar');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('registra, entra y muestra el nombre del jugador', async () => {
    const fetchMock = mockApi({
      'POST /auth/register': () => ({ status: 201, body: me }),
      'POST /auth/login': () => ({ body: { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600 } }),
      'GET /users/me': () => ({ body: me }),
    });
    renderAt('/registro');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Correo'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText(/Contraseña/), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByRole('heading', { name: 'Mundos' })).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(localStorage.getItem('mbr.token')).toBe('tok');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ body: expect.stringContaining('"displayName":"Ana"') }),
    );
  });

  it('muestra el error de credenciales inválidas', async () => {
    mockApi({
      'POST /auth/login': () => ({
        status: 401,
        body: { statusCode: 401, message: 'Credenciales inválidas.' },
      }),
    });
    renderAt('/entrar');
    await userEvent.type(screen.getByLabelText('Correo'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala-clave-123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas.');
  });
});

describe('partida', () => {
  beforeEach(() => localStorage.setItem('mbr.token', 'tok'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  const base = {
    'GET /users/me': () => ({ body: me }),
    'GET /worlds/arithmetic/progress': () => ({ body: progress() }),
    'POST /worlds/arithmetic/sessions': () => ({
      status: 201,
      body: { session: { id: 's1', worldSlug: 'arithmetic' }, created: true },
    }),
  };

  it('juega un acierto (puntos y regla nueva) y pasa al siguiente reto', async () => {
    let n = 0;
    const answers: unknown[] = [];
    mockApi({
      ...base,
      'POST /sessions/s1/attempts': () => ({
        status: 201,
        body:
          n++ === 0
            ? attempt()
            : attempt({
                attemptId: 'a2',
                position: 2,
                expression: '3 * 7 * 2',
                rules: [rule2],
                newRule: rule2,
              }),
      }),
      'POST /attempts/a1/answer': (b) => {
        answers.push(b);
        return { body: answer({ unlockedRule: rule2 }) };
      },
    });
    renderAt('/mundos/arithmetic/jugar');

    await userEvent.click(await screen.findByRole('button', { name: 'Empezar a jugar' }));
    expect(await screen.findByTestId('challenge-expression')).toHaveTextContent('3 * 7');
    expect(screen.getByRole('timer')).toHaveTextContent('1:00');

    await userEvent.type(screen.getByLabelText('Tu expresión'), '7 * 1 * 3');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('heading', { name: '¡Correcto!' })).toBeInTheDocument();
    expect(answers).toEqual([{ expression: '7 * 1 * 3' }]);
    expect(screen.getByText(/\+100 puntos/)).toBeInTheDocument();
    expect(screen.getByText(/Regla desbloqueada/)).toHaveTextContent('No puedes usar el dígito 2.');
    expect(screen.getByText('×1.5')).toBeInTheDocument(); // multiplicador del próximo acierto

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente reto' }));
    expect(await screen.findByText('Reto 2 de 4')).toBeInTheDocument();
    expect(screen.getByText('Nueva')).toBeInTheDocument();
    expect(screen.getByLabelText('Reglas activas')).toHaveTextContent('No puedes usar el dígito 2.');
  });

  it('un fallo reinicia la secuencia, muestra la violación y permite reiniciar', async () => {
    let n = 0;
    mockApi({
      ...base,
      'POST /sessions/s1/attempts': () => ({
        status: 201,
        body:
          n++ === 0
            ? attempt({ position: 2, rules: [rule2], newRule: rule2 })
            : attempt({ attemptId: 'a2', rules: [rule2] }),
      }),
      'POST /attempts/a1/answer': () => ({
        body: answer({
          outcome: 'INCORRECT',
          failureReason: 'RULE_VIOLATION',
          message: 'Tu expresión rompe una regla.',
          evaluatedValue: '42',
          violations: [
            {
              ruleKey: 'r2',
              ruleType: 'FORBIDDEN_DIGIT',
              description: rule2.description,
              message: 'Usaste el 2.',
            },
          ],
          score: { basePoints: 0, multiplierMilli: 0, multiplier: '0', points: 0 },
          sequenceRestarted: true,
          progress: progress({ unlockedRules: [{ ...rule2, unlockedAt: '' }] }),
        }),
      }),
    });
    renderAt('/mundos/arithmetic/jugar');
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar a jugar' }));
    await userEvent.type(await screen.findByLabelText('Tu expresión'), '21 * 2');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('heading', { name: 'Respuesta incorrecta' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reglas incumplidas')).toHaveTextContent('Usaste el 2.');
    expect(screen.getByText(/la secuencia se reinicia/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar secuencia' }));
    expect(await screen.findByText('Reto 1 de 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Reglas activas')).toHaveTextContent('No puedes usar el dígito 2.');
  });

  it('al agotarse el tiempo pregunta al servidor y muestra el TIMEOUT', async () => {
    const calls: string[] = [];
    mockApi({
      ...base,
      'POST /sessions/s1/attempts': () => ({ status: 201, body: attempt({ remainingMs: 200 }) }),
      'GET /sessions/s1/attempts/current': () => {
        calls.push('current');
        return { status: 404, body: { message: 'No hay un reto en curso.' } };
      },
      'POST /attempts/a1/answer': () => {
        calls.push('answer');
        return {
          body: answer({
            outcome: 'TIMEOUT',
            failureReason: 'TIMEOUT',
            message: 'Se acabó el tiempo.',
            evaluatedValue: null,
            sequenceRestarted: true,
            replayed: true,
          }),
        };
      },
    });
    renderAt('/mundos/arithmetic/jugar');
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar a jugar' }));
    expect(
      await screen.findByRole('heading', { name: 'Se acabó el tiempo' }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(calls).toEqual(['current', 'answer']);
    expect(screen.getByRole('button', { name: 'Reiniciar secuencia' })).toBeInTheDocument();
  });

  it('muestra el error del servidor al iniciar y permite reintentar', async () => {
    mockApi({
      ...base,
      'GET /worlds/arithmetic/progress': () => ({
        status: 500,
        body: { message: 'Error interno del servidor.' },
      }),
    });
    renderAt('/mundos/arithmetic/jugar');
    expect(await screen.findByRole('alert')).toHaveTextContent('Error interno del servidor.');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('progreso', () => {
  beforeEach(() => localStorage.setItem('mbr.token', 'tok'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('muestra el estado vacío si aún no ha jugado', async () => {
    mockApi({
      'GET /users/me': () => ({ body: me }),
      'GET /worlds/arithmetic/progress': () => ({ body: progress() }),
      'GET /worlds/arithmetic/score?limit=5': () => ({
        body: {
          worldSlug: 'arithmetic',
          totalPoints: 0,
          streak: 0,
          bestStreak: 0,
          nextMultiplier: '1',
          recentTransactions: [],
        },
      }),
      'GET /worlds/arithmetic/attempts?limit=10': () => ({ body: { items: [], nextCursor: null } }),
    });
    renderAt('/progreso');
    expect(await screen.findByText(/Aún no has jugado/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Empezar a jugar' })).toHaveAttribute(
      'href',
      '/mundos/arithmetic/jugar',
    );
  });

  it('muestra puntos, racha, reglas e historial', async () => {
    mockApi({
      'GET /users/me': () => ({ body: me }),
      'GET /worlds/arithmetic/progress': () => ({
        body: progress({
          totalPoints: 250,
          streak: 2,
          bestStreak: 3,
          nextMultiplier: '2',
          unlockedRules: [{ ...rule2, unlockedAt: '' }],
          statistics: { ...progress().statistics, attemptsCount: 3, correctCount: 2, incorrectCount: 1 },
        }),
      }),
      'GET /worlds/arithmetic/score?limit=5': () => ({
        body: {
          worldSlug: 'arithmetic',
          totalPoints: 250,
          streak: 2,
          bestStreak: 3,
          nextMultiplier: '2',
          recentTransactions: [],
        },
      }),
      'GET /worlds/arithmetic/attempts?limit=10': () => ({
        body: {
          items: [
            {
              attemptId: 'x',
              position: 2,
              expression: '3 * 7 * 2',
              outcome: 'CORRECT',
              failureReason: null,
              submission: '7*1*6',
              evaluatedValue: '42',
              startedAt: '',
              elapsedMs: 1000,
              streakBefore: 1,
              pointsAwarded: 150,
            },
          ],
          nextCursor: null,
        },
      }),
    });
    renderAt('/progreso');
    expect(await screen.findByText('250')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByText('Reglas desbloqueadas (1)')).toBeInTheDocument();
    expect(screen.getByText('7*1*6')).toBeInTheDocument();
  });
});
