import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arithmeticWorld,
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
} from '@/test/utils';

function progressApi(extra: Record<string, Handler>) {
  return mockApi({
    'GET /users/me': () => ok(student),
    'GET /worlds': () => ok([arithmeticWorld]),
    'GET /worlds/arithmetic/progress': () => ok(progress()),
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
    expect(screen.getByRole('status')).toHaveTextContent(/Aún no has jugado/);
    expect(within(screen.getByLabelText('Resumen')).getByRole('link', { name: 'Jugar' })).toHaveAttribute(
      'href',
      '/juego',
    );
    expect(screen.queryByRole('heading', { name: 'Estadísticas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Últimos intentos' })).not.toBeInTheDocument();
    // Solo usa los endpoints existentes.
    expect(api.calls.map((call) => call.key).sort()).toEqual(
      [
        'GET /users/me',
        'GET /worlds',
        'GET /worlds/arithmetic/attempts?limit=10',
        'GET /worlds/arithmetic/progress',
        'GET /worlds/arithmetic/score?limit=10',
      ].sort(),
    );
  });

  it('muestra puntos, rachas, multiplicador, reglas desbloqueadas, estadísticas, historial y libro de puntos', async () => {
    progressApi({
      'GET /worlds/arithmetic/progress': () =>
        ok(
          progress({
            currentPosition: 3,
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
    expect(summary).toHaveTextContent('3/4');
    expect(within(summary).getByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/juego');

    const stats = screen.getByRole('heading', { name: 'Estadísticas' }).closest('section') as HTMLElement;
    expect(stats).toHaveTextContent(/Intentos\s*5/);
    expect(stats).toHaveTextContent(/Aciertos\s*3/);
    expect(stats).toHaveTextContent(/Fallos\s*1/);
    expect(stats).toHaveTextContent(/Sin tiempo\s*1/);
    expect(stats).toHaveTextContent('12.5 s');

    expect(screen.getByRole('heading', { name: 'Reglas descubiertas (2)' })).toBeInTheDocument();
    const rules = screen
      .getByRole('heading', { name: 'Reglas descubiertas (2)' })
      .closest('section') as HTMLElement;
    expect(within(rules).getAllByText(rule2.description).length).toBeGreaterThan(0);
    expect(within(rules).getAllByText(rule7x1.description).length).toBeGreaterThan(0);

    // Reglas más incumplidas: solo las que el jugador ya conoce; nunca se nombra una aún no descubierta.
    const violated = within(screen.getByRole('list', { name: 'Reglas incumplidas' }));
    expect(violated.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `${rule2.description}2`,
      `${rule7x1.description}1`,
    ]);
    expect(screen.queryByText(/regla-aun-no-descubierta/)).not.toBeInTheDocument();

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
      'GET /worlds/arithmetic/progress': () =>
        ok(
          progress({
            status: 'COMPLETED',
            currentPosition: 5,
            totalPoints: 1000,
            statistics: { ...progress().statistics, attemptsCount: 4, correctCount: 4 },
          }),
        ),
      'GET /worlds/arithmetic/attempts?limit=10': () => ok({ items: [historyItem()], nextCursor: null }),
    });
    renderApp('/progreso');

    const summary = await screen.findByLabelText('Resumen');
    expect(summary).toHaveTextContent('4/4');
    expect(summary).toHaveTextContent('Mundo completado');
    expect(within(summary).getByRole('link', { name: 'Jugar de nuevo' })).toBeInTheDocument();
  });

  it('muestra "no disponible" cuando faltan datos: sin tiempo medio, sin reglas, sin historial ni puntos', async () => {
    progressApi({
      'GET /worlds/arithmetic/progress': () =>
        ok(progress({ statistics: { ...progress().statistics, attemptsCount: 1, incorrectCount: 1 } })),
    });
    renderApp('/progreso');

    const stats = (await screen.findByRole('heading', { name: 'Estadísticas' })).closest(
      'section',
    ) as HTMLElement;
    expect(stats).toHaveTextContent(/Tiempo medio\s*—/);
    expect(screen.getByText('Todavía ninguna.')).toBeInTheDocument();
    expect(screen.getByText('No hay intentos para mostrar.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Últimos puntos ganados' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Reglas incumplidas' })).not.toBeInTheDocument();
  });

  it('si el mundo no figura en la lista, sigue funcionando con los datos del progreso', async () => {
    progressApi({ 'GET /worlds': () => ok([]) });
    renderApp('/progreso');

    expect(await screen.findByText('Mundo 1')).toBeInTheDocument();
  });

  it('muestra el error y permite reintentar', async () => {
    const api = progressApi({
      'GET /worlds/arithmetic/score?limit=10': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(scoreSummary()),
      ),
    });
    renderApp('/progreso');

    expect(await screen.findByText('No pudimos cargar tu progreso')).toBeInTheDocument();
    expect(screen.getByText('Error interno del servidor.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('heading', { name: 'Mi progreso' })).toBeInTheDocument();
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
