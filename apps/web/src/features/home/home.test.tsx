import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arithmeticWorld,
  attempt,
  type Handler,
  mockApi,
  ok,
  progress,
  renderApp,
  rule2,
  scoreSummary,
  sequence,
  signIn,
  student,
} from '@/test/utils';

const later = {
  ...arithmeticWorld,
  slug: 'signs',
  name: 'Números y signos',
  position: 2,
  description: 'Positivos y negativos.',
};

function home(extra: Record<string, Handler> = {}) {
  return mockApi({
    'GET /users/me': () => ok(student),
    'GET /worlds': () => ok([arithmeticWorld, later]),
    'GET /progress': () => ok([progress()]),
    ...extra,
  });
}

beforeEach(() => signIn());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('inicio', () => {
  it('jugador nuevo: ofrece Jugar y no muestra reglas ni estadísticas', async () => {
    home();
    renderApp('/');

    const world = (await screen.findByRole('heading', { name: 'Aritmética' })).closest(
      'article',
    ) as HTMLElement;
    expect(within(world).getByRole('button', { name: 'Jugar' })).toBeEnabled();
    expect(within(world).queryByText('REGLAS DESCUBIERTAS')).not.toBeInTheDocument();
    expect(within(world).queryByText('Intentos')).not.toBeInTheDocument();
  });

  it('muestra solo los datos del servidor: puntos, racha, desafío, reglas descubiertas y estadísticas', async () => {
    home({
      'GET /progress': () =>
        ok([
          progress({
            currentPosition: 3,
            totalPoints: 450,
            streak: 3,
            bestStreak: 3,
            unlockedRules: [{ ...rule2, unlockedAt: '2026-11-21T10:00:00.000Z' }],
            statistics: {
              attemptsCount: 4,
              correctCount: 3,
              incorrectCount: 1,
              timeoutCount: 0,
              averageCorrectElapsedMs: 8_200,
              ruleViolationCounts: {},
            },
          }),
        ]),
    });
    renderApp('/');

    const world = (await screen.findByRole('heading', { name: 'Aritmética' })).closest(
      'article',
    ) as HTMLElement;
    expect(world).toHaveTextContent(/Puntos\s*450/);
    expect(world).toHaveTextContent(/Desafío\s*3\/4/);
    expect(within(world).getByText(rule2.description)).toBeInTheDocument();
    expect(world).toHaveTextContent(/Tiempo medio\s*8\.2 s/);
    expect(within(world).getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('mundo completado: muestra el avance completo y permite jugar de nuevo', async () => {
    home({
      'GET /progress': () =>
        ok([
          progress({
            status: 'COMPLETED',
            currentPosition: 5,
            statistics: { ...progress().statistics, attemptsCount: 4 },
          }),
        ]),
    });
    renderApp('/');

    const world = (await screen.findByRole('heading', { name: 'Aritmética' })).closest(
      'article',
    ) as HTMLElement;
    expect(world).toHaveTextContent(/Desafío\s*4\/4/);
    expect(within(world).getByRole('button', { name: 'Jugar de nuevo' })).toBeInTheDocument();
  });

  it('los mundos que aún no se pueden jugar aparecen como "Próximamente" y deshabilitados', async () => {
    home();
    renderApp('/');

    const world = (await screen.findByRole('heading', { name: 'Números y signos' })).closest(
      'article',
    ) as HTMLElement;
    expect(within(world).getByRole('button', { name: 'Próximamente' })).toBeDisabled();
  });

  it('Jugar lleva a la partida', async () => {
    home({
      'POST /worlds/arithmetic/sessions': () => ({
        status: 201,
        body: { session: { id: 's1', worldSlug: 'arithmetic' }, created: true, expiredAttempt: null },
      }),
      'POST /sessions/s1/attempts': sequence({ status: 201, body: attempt() }),
      'GET /worlds/arithmetic/progress': () => ok(progress()),
    });
    renderApp('/');

    await userEvent.click(await screen.findByRole('button', { name: 'Jugar' }));

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/juego');
  });

  it('enlaza con Mi progreso y con Clasificaciones', async () => {
    home({
      'GET /worlds/arithmetic/progress': () => ok(progress()),
      'GET /worlds/arithmetic/score?limit=10': () => ok(scoreSummary()),
      'GET /worlds/arithmetic/attempts?limit=10': () => ok({ items: [], nextCursor: null }),
    });
    renderApp('/');

    expect(await screen.findByRole('link', { name: /Clasificaciones/ })).toHaveAttribute(
      'href',
      '/clasificaciones',
    );
    await userEvent.click(screen.getByRole('link', { name: /Mi progreso/ }));

    expect(await screen.findByRole('heading', { name: 'Mi progreso' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/progreso');
  });

  it('sin mundos disponibles lo dice', async () => {
    home({ 'GET /worlds': () => ok([]), 'GET /progress': () => ok([]) });
    renderApp('/');

    expect(await screen.findByText('Todavía no hay mundos disponibles.')).toBeInTheDocument();
  });

  it('si falla la carga muestra el error y permite reintentar', async () => {
    const api = home({
      'GET /progress': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok([progress()]),
      ),
    });
    renderApp('/');

    expect(await screen.findByText('No pudimos cargar tu aventura')).toBeInTheDocument();
    expect(screen.getByText('Error interno del servidor.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('heading', { name: 'Aritmética' })).toBeInTheDocument();
    expect(api.count('GET /progress')).toBe(2);
  });
});
