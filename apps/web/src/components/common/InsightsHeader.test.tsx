import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allWorlds,
  attempt,
  mockApi,
  ok,
  progress,
  renderApp,
  scoreSummary,
  signIn,
  student,
  teacher,
  worldsProgress,
} from '@/test/utils';

const navigation = () => screen.getByRole('navigation', { name: 'Navegación principal' });

const board = {
  worldSlug: 'arithmetic',
  scope: 'SELF',
  participants: 1,
  entries: [],
  me: { rank: 1, displayName: 'Ana', points: 0, isCurrentUser: true },
};

beforeEach(() => signIn());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('cabecera: "Jugar"', () => {
  it('desde Mi progreso lleva a la partida (/juego), no al inicio', async () => {
    const api = mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'GET /progress': () => ok(worldsProgress()),
      'GET /worlds/arithmetic/progress': () => ok(progress()),
      'GET /worlds/arithmetic/score?limit=10': () => ok(scoreSummary()),
      'GET /worlds/arithmetic/attempts?limit=10': () => ok({ items: [], nextCursor: null }),
      'POST /worlds/arithmetic/sessions': () => ({
        status: 201,
        body: {
          session: {
            id: 's1',
            worldSlug: 'arithmetic',
            startedAt: '2026-11-21T10:00:00.000Z',
            endedAt: null,
          },
          created: true,
          expiredAttempt: null,
        },
      }),
      'POST /sessions/s1/attempts': () => ({ status: 201, body: attempt() }),
    });
    renderApp('/progreso');
    await screen.findByRole('heading', { name: 'Mi progreso' });

    const play = within(navigation()).getByRole('link', { name: 'Jugar' });
    expect(play).toHaveAttribute('href', '/juego');
    await userEvent.click(play);

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    // `/juego` lleva al mundo más indicado.
    expect(screen.getByTestId('location')).toHaveTextContent('/juego/arithmetic');
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(1);
  });

  it('desde Clasificaciones también apunta a la partida; el logotipo sigue llevando al inicio', async () => {
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'GET /progress': () => ok(worldsProgress()),
      'GET /worlds/arithmetic/leaderboard?limit=50': () => ok(board),
    });
    renderApp('/clasificaciones');
    await screen.findByRole('heading', { name: 'Clasificaciones' });

    expect(within(navigation()).getByRole('link', { name: 'Jugar' })).toHaveAttribute('href', '/juego');
    expect(screen.getByRole('link', { name: 'EUREKA, ir al inicio' })).toHaveAttribute('href', '/');
  });

  it('un docente no ve "Jugar" y solo tiene su panel', async () => {
    mockApi({
      'GET /users/me': () => ok(teacher),
      'GET /teacher/dashboard': () => ok({ generatedAt: '2026-11-21T10:00:00.000Z', groups: [] }),
    });
    renderApp('/docente');

    expect(
      await within(await screen.findByRole('navigation')).findByRole('link', { name: 'Panel docente' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Jugar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mi progreso' })).not.toBeInTheDocument();
  });
});
