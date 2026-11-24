import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allWorlds,
  historyItem,
  type Handler,
  mockApi,
  ok,
  progress,
  renderApp,
  rule2,
  rule7x1,
  scoreSummary,
  sequence,
  signIn,
  student,
  worldsProgress,
} from '@/test/utils';
import type { WorldProgress } from '@/services/api/types';

/** El progreso del Mundo 1 (los demás, bloqueados en cadena) en `GET /progress`. */
const withFirst = (first: Partial<WorldProgress>) => () => ok(worldsProgress(first));

function progressApi(extra: Record<string, Handler>) {
  return mockApi({
    'GET /users/me': () => ok(student),
    'GET /worlds': () => ok(allWorlds),
    'GET /progress': () => ok(worldsProgress()),
    'GET /worlds/arithmetic/score?limit=10': () => ok(scoreSummary()),
    'GET /worlds/arithmetic/attempts?limit=10': () => ok({ items: [], nextCursor: null }),
    ...extra,
  });
}

beforeEach(() => signIn());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Mi progreso', () => {
  it('jugador nuevo: estado vacío con acceso directo al juego y sin secciones de datos', async () => {
    const api = progressApi({});
    renderApp('/progreso');

    expect(await screen.findByRole('heading', { name: 'Mi progreso' })).toBeInTheDocument();
    expect(screen.getByText('Mundo 1 · Aritmética')).toBeInTheDocument();
    expect(screen.getByText(/Aún no has jugado/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Resumen')).getByRole('link', { name: 'Jugar' })).toHaveAttribute(
      'href',
      '/juego/arithmetic',
    );
    expect(screen.queryByRole('heading', { name: 'Estadísticas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Últimos intentos' })).not.toBeInTheDocument();
    // Solo usa los endpoints existentes (el historial del mundo se pide después del catálogo).
    await waitFor(() => expect(api.count('GET /worlds/arithmetic/attempts?limit=10')).toBe(1));
    expect(api.calls.map((call) => call.key).sort()).toEqual(
      [
        'GET /users/me',
        'GET /worlds',
        'GET /progress',
        'GET /worlds/arithmetic/attempts?limit=10',
        'GET /worlds/arithmetic/score?limit=10',
      ].sort(),
    );
  });

  it('muestra puntos, rachas, multiplicador, reglas dominadas, estadísticas, historial y libro de puntos', async () => {
    progressApi({
      'GET /progress': () =>
        ok(
          worldsProgress({
            currentPosition: 3,
            activeSequence: { id: 'q1', difficulty: 'EASIER', challengeCount: 3, rules: [] },
            totalPoints: 450,
            streak: 2,
            bestStreak: 3,
            nextMultiplierMilli: 2000,
            nextMultiplier: '2',
            unlockedRules: [
              { ...rule2, unlockedAt: '2026-11-21T10:05:00.000Z' },
              { ...rule7x1, unlockedAt: '2026-11-21T10:06:00.000Z' },
            ],
            statistics: {
              attemptsCount: 5,
              correctCount: 3,
              incorrectCount: 1,
              timeoutCount: 1,
              averageCorrectElapsedMs: 12_500,
              ruleViolationCounts: { r2: 2, r7: 1, 'regla-aun-no-descubierta': 4 },
            },
          }),
        ),
      'GET /worlds/arithmetic/score?limit=10': () =>
        ok(
          scoreSummary({
            recentTransactions: [
              {
                id: 't2',
                attemptId: 'h2',
                reason: 'CORRECT_ANSWER',
                basePoints: 100,
                multiplierMilli: 1500,
                multiplier: '1.5',
                points: 150,
                streakAfter: 2,
                createdAt: '2026-11-21T10:05:00.000Z',
              },
            ],
          }),
        ),
      'GET /worlds/arithmetic/attempts?limit=10': () =>
        ok({
          items: [
            historyItem({
              attemptId: 'h4',
              position: 4,
              expression: '5 * 8',
              outcome: 'PENDING',
              submission: null,
              pointsAwarded: 0,
            }),
            historyItem({
              attemptId: 'h3',
              position: 3,
              expression: '3 * 7 * 2 / 6',
              outcome: 'TIMEOUT',
              submission: null,
              pointsAwarded: 0,
            }),
            historyItem({
              attemptId: 'h2',
              position: 2,
              expression: '3 * 7 * 2',
              outcome: 'INCORRECT',
              submission: '21 * 2',
              pointsAwarded: 0,
            }),
            historyItem({
              attemptId: 'h1',
              position: 1,
              expression: '3 * 7',
              outcome: 'CORRECT',
              submission: '7 * 1 * 3',
              pointsAwarded: 150,
            }),
          ],
          nextCursor: null,
        }),
    });
    renderApp('/progreso');

    const summary = await screen.findByLabelText('Resumen');
    expect(summary).toHaveTextContent(/Puntos\s*450/);
    expect(summary).toHaveTextContent(/Racha\s*2/);
    expect(summary).toHaveTextContent(/Mejor racha\s*3/);
    expect(summary).toHaveTextContent('×2');
    expect(summary).toHaveTextContent(/Secuencia en curso: desafío\s*3\/3/);
    expect(within(summary).getByText('Suave')).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Continuar' })).toHaveAttribute(
      'href',
      '/juego/arithmetic',
    );

    const stats = screen.getByRole('heading', { name: 'Estadísticas' }).closest('section') as HTMLElement;
    expect(stats).toHaveTextContent(/Intentos\s*5/);
    expect(stats).toHaveTextContent(/Aciertos\s*3/);
    expect(stats).toHaveTextContent(/Fallos\s*1/);
    expect(stats).toHaveTextContent(/Sin tiempo\s*1/);
    expect(stats).toHaveTextContent('12.5 s');

    expect(screen.getByRole('heading', { name: 'Reglas dominadas (2/6)' })).toBeInTheDocument();
    const rules = screen
      .getByRole('heading', { name: 'Reglas dominadas (2/6)' })
      .closest('section') as HTMLElement;
    expect(rules).toHaveTextContent('aunque después falles una secuencia');
    expect(within(rules).getAllByText(rule2.description).length).toBeGreaterThan(0);
    expect(within(rules).getAllByText(rule7x1.description).length).toBeGreaterThan(0);

    // Reglas más incumplidas: solo las que el jugador ya conoce; nunca se nombra una aún no descubierta.
    const violated = within(screen.getByRole('list', { name: 'Reglas incumplidas' }));
    expect(violated.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `${rule2.description}2`,
      `${rule7x1.description}1`,
    ]);
    expect(screen.queryByText(/regla-aun-no-descubierta/)).not.toBeInTheDocument();

    await screen.findByRole('heading', { name: 'Últimos puntos ganados' });
    const attempts = within(
      screen.getByRole('heading', { name: 'Últimos intentos' }).closest('section') as HTMLElement,
    );
    const rows = attempts.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-outcome'))).toEqual([
      'PENDING',
      'TIMEOUT',
      'INCORRECT',
      'CORRECT',
    ]);
    expect(rows[0]).toHaveTextContent('En curso');
    expect(rows[1]).toHaveTextContent('Sin tiempo');
    expect(rows[2]).toHaveTextContent('Incorrecto');
    expect(rows[2]).toHaveTextContent('21 * 2');
    expect(rows[3]).toHaveTextContent('Correcto');
    expect(rows[3]).toHaveTextContent('+150');
    expect(rows[1]).toHaveTextContent('Tu respuesta: —');

    const ledger = within(
      screen.getByRole('heading', { name: 'Últimos puntos ganados' }).closest('section') as HTMLElement,
    );
    expect(ledger.getByText('100 × 1.5 · racha 2')).toBeInTheDocument();
    expect(ledger.getByText('+150')).toBeInTheDocument();
  });

  it('mundo completado: lo indica y ofrece jugar de nuevo', async () => {
    progressApi({
      'GET /progress': () =>
        ok(
          worldsProgress({
            status: 'COMPLETED',
            completionsCount: 3,
            currentPosition: 5,
            totalPoints: 1000,
            statistics: { ...progress().statistics, attemptsCount: 4, correctCount: 4 },
          }),
        ),
      'GET /worlds/arithmetic/attempts?limit=10': () => ok({ items: [historyItem()], nextCursor: null }),
    });
    renderApp('/progreso');

    const summary = await screen.findByLabelText('Resumen');
    expect(summary).toHaveTextContent('Sin secuencia en curso');
    expect(summary).toHaveTextContent('Mundo completado · 3 veces');
    expect(within(summary).getByRole('link', { name: 'Jugar de nuevo' })).toBeInTheDocument();
  });

  it('muestra "no disponible" cuando faltan datos: sin tiempo medio, sin reglas, sin historial ni puntos', async () => {
    progressApi({
      'GET /progress': withFirst({
        statistics: { ...progress().statistics, attemptsCount: 1, incorrectCount: 1 },
      }),
    });
    renderApp('/progreso');

    const stats = (await screen.findByRole('heading', { name: 'Estadísticas' })).closest(
      'section',
    ) as HTMLElement;
    expect(stats).toHaveTextContent(/Tiempo medio\s*—/);
    expect(screen.getByText('Todavía ninguna.')).toBeInTheDocument();
    expect(await screen.findByText('No hay intentos para mostrar.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Últimos puntos ganados' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Reglas incumplidas' })).not.toBeInTheDocument();
  });

  it('un mundo desconocido en la URL lo dice y ofrece volver al mapa', async () => {
    progressApi({});
    renderApp('/progreso/no-existe');

    expect(await screen.findByRole('heading', { name: 'No encontramos ese mundo' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al mapa' })).toHaveAttribute('href', '/');
  });

  it('cambia de mundo con el selector: datos e historial del mundo elegido', async () => {
    const api = progressApi({
      'GET /progress': () =>
        ok([
          progress({
            status: 'COMPLETED',
            completionsCount: 1,
            totalPoints: 900,
            statistics: { ...progress().statistics, attemptsCount: 4 },
          }),
          progress({
            worldSlug: 'signs',
            totalPoints: 120,
            statistics: { ...progress().statistics, attemptsCount: 2 },
          }),
          ...worldsProgress().slice(2),
        ]),
      'GET /worlds/signs/score?limit=10': () => ok(scoreSummary({ worldSlug: 'signs' })),
      'GET /worlds/signs/attempts?limit=10': () =>
        ok({ items: [historyItem({ expression: '-3 * 4', submission: '-12' })], nextCursor: null }),
    });
    renderApp('/progreso/arithmetic');

    const tabs = within(await screen.findByRole('navigation', { name: 'Elige un mundo' }));
    expect(tabs.getAllByRole('link')).toHaveLength(5);
    expect(tabs.getByRole('link', { name: /Aritmética/ })).toHaveAttribute('aria-current', 'page');
    expect(tabs.getByRole('link', { name: /Aritmética/ })).toHaveAccessibleName(
      'Mundo 1: Aritmética (completado)',
    );
    expect(tabs.getByRole('link', { name: /Fracciones/ })).toHaveAccessibleName(
      'Mundo 3: Fracciones y decimales (bloqueado)',
    );
    expect(screen.getByLabelText('Resumen')).toHaveTextContent(/Puntos\s*900/);

    await userEvent.click(tabs.getByRole('link', { name: /Números y signos/ }));

    expect(await screen.findByText('Mundo 2 · Números y signos')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/progreso/signs');
    expect(screen.getByLabelText('Resumen')).toHaveTextContent(/Puntos\s*120/);
    expect(await screen.findByText('-3 * 4')).toBeInTheDocument();
    expect(api.count('GET /worlds/signs/attempts?limit=10')).toBe(1);
    // El catálogo se pide una sola vez.
    expect(api.count('GET /progress')).toBe(1);
  });

  it('un mundo bloqueado muestra qué mundo completar y no pide su historial', async () => {
    const api = progressApi({});
    renderApp('/progreso/fractions');

    expect(
      await screen.findByText('Completa el Mundo 2 (Números y signos) para desbloquear.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver el Mundo 2' })).toHaveAttribute('href', '/progreso/signs');
    expect(api.calls.some((call) => call.key.startsWith('GET /worlds/fractions/'))).toBe(false);
  });

  it('sin mundo en la URL abre el mundo más jugado, no uno sin estrenar', async () => {
    progressApi({
      'GET /progress': () =>
        ok([
          progress({
            status: 'COMPLETED',
            completionsCount: 1,
            totalPoints: 800,
            statistics: { ...progress().statistics, attemptsCount: 6 },
          }),
          progress({ worldSlug: 'signs' }),
          ...worldsProgress().slice(2),
        ]),
    });
    renderApp('/progreso');

    expect(await screen.findByText('Mundo 1 · Aritmética')).toBeInTheDocument();
  });

  it('sin mundo en la URL y sin haber jugado, abre el más indicado (el primero desbloqueado y sin completar)', async () => {
    progressApi({
      'GET /progress': () =>
        ok([
          progress({ status: 'COMPLETED', completionsCount: 1 }),
          progress({ worldSlug: 'signs' }),
          ...worldsProgress().slice(2),
        ]),
      'GET /worlds/signs/score?limit=10': () => ok(scoreSummary({ worldSlug: 'signs' })),
      'GET /worlds/signs/attempts?limit=10': () => ok({ items: [], nextCursor: null }),
    });
    renderApp('/progreso');

    expect(await screen.findByText('Mundo 2 · Números y signos')).toBeInTheDocument();
  });

  it('muestra el error y permite reintentar', async () => {
    const api = progressApi({
      'GET /progress': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(worldsProgress()),
      ),
    });
    renderApp('/progreso');

    expect(await screen.findByText('No pudimos cargar tu progreso')).toBeInTheDocument();
    expect(screen.getByText('Error interno del servidor.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('heading', { name: 'Mi progreso' })).toBeInTheDocument();
    expect(api.count('GET /progress')).toBe(2);
  });

  it('si falla el historial del mundo, lo dice en su sección y permite reintentar', async () => {
    const api = progressApi({
      'GET /progress': withFirst({ statistics: { ...progress().statistics, attemptsCount: 1 } }),
      'GET /worlds/arithmetic/score?limit=10': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(scoreSummary()),
      ),
    });
    renderApp('/progreso');

    expect(await screen.findByRole('alert')).toHaveTextContent('Error interno del servidor.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('No hay intentos para mostrar.')).toBeInTheDocument();
    expect(api.count('GET /worlds/arithmetic/score?limit=10')).toBe(2);
  });

  it('es solo para estudiantes: un docente no puede abrirla', async () => {
    mockApi({
      'GET /users/me': () => ok({ ...student, role: 'TEACHER' }),
      'GET /teacher/dashboard': () => ({ status: 500, body: { message: 'x' } }),
    });
    renderApp('/progreso');

    expect(await screen.findByText('No pudimos cargar tu panel')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/docente');
  });

  it('sin sesión redirige al acceso', async () => {
    localStorage.clear();
    mockApi({});
    renderApp('/progreso');

    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
  });
});
