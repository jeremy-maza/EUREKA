import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allWorlds,
  type Handler,
  mockApi,
  ok,
  progress,
  renderApp,
  sequence,
  signIn,
  student,
  worldsProgress,
} from '@/test/utils';
import type { Leaderboard } from '@/services/api/types';

const entry = (rank: number, displayName: string, points: number, isCurrentUser = false) => ({
  rank,
  displayName,
  points,
  isCurrentUser,
});

function board(over: Partial<Leaderboard> = {}): Leaderboard {
  const me = entry(2, 'Ana', 450, true);
  return {
    worldSlug: 'arithmetic',
    scope: 'GROUPS',
    participants: 3,
    entries: [entry(1, 'Luis', 900), me, entry(3, 'Marta', 100)],
    me,
    ...over,
  };
}

function boardApi(extra: Record<string, Handler>) {
  return mockApi({
    'GET /users/me': () => ok(student),
    'GET /worlds': () => ok(allWorlds),
    'GET /progress': () => ok(worldsProgress()),
    ...extra,
  });
}

beforeEach(() => signIn());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('clasificaciones', () => {
  it('muestra la clasificación del grupo con el puesto del propio jugador resaltado', async () => {
    boardApi({
      'GET /worlds/arithmetic/leaderboard?limit=50': () => ok(board()),
    });
    renderApp('/clasificaciones');

    expect(await screen.findByRole('heading', { name: 'Clasificaciones' })).toBeInTheDocument();
    expect(screen.getByText('Compañeros de tus grupos · Mundo 1')).toBeInTheDocument();
    expect(screen.getByText('3 en la ruta')).toBeInTheDocument();
    const rows = within(
      screen.getByRole('heading', { name: 'Exploradores de Aritmética' }).closest('section') as HTMLElement,
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Ana');
    expect(rows[1]).toHaveTextContent('Tu recorrido');
    expect(rows[1]).toHaveTextContent('450');
  });

  it('sin grupo explica cómo compararse con compañeros', async () => {
    const me = entry(1, 'Ana', 0, true);
    boardApi({
      'GET /worlds/arithmetic/leaderboard?limit=50': () =>
        ok(board({ scope: 'SELF', participants: 1, entries: [me], me })),
    });
    renderApp('/clasificaciones');

    expect(await screen.findByText(/Aún no perteneces a un grupo/)).toBeInTheDocument();
  });

  it('si el jugador queda fuera del recorte de la lista, se añade al final', async () => {
    const me = entry(60, 'Ana', 5, true);
    boardApi({
      'GET /worlds/arithmetic/leaderboard?limit=50': () =>
        ok(board({ participants: 60, entries: [entry(1, 'Luis', 900), entry(2, 'Marta', 800)], me })),
    });
    renderApp('/clasificaciones');

    await screen.findByRole('heading', { name: 'Clasificaciones' });
    const rows = screen.getAllByRole('listitem').filter((item) => item.textContent?.includes('pts'));
    expect(rows.at(-1)).toHaveTextContent('Ana');
    expect(rows.at(-1)).toHaveTextContent('60');
  });

  it('si no se pueden cargar los mundos, muestra el error y permite reintentar', async () => {
    boardApi({
      'GET /worlds': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(allWorlds),
      ),
      'GET /worlds/arithmetic/leaderboard?limit=50': () => ok(board()),
    });
    renderApp('/clasificaciones');

    expect(await screen.findByText('No pudimos cargar la clasificación')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Clasificaciones' })).toBeInTheDocument();
  });

  it('cambia de mundo con las pestañas y pide la clasificación de ese mundo', async () => {
    const api = boardApi({
      'GET /progress': () =>
        ok([
          progress({ status: 'COMPLETED', completionsCount: 1 }),
          progress({ worldSlug: 'signs' }),
          ...worldsProgress().slice(2),
        ]),
      'GET /worlds/arithmetic/leaderboard?limit=50': () => ok(board()),
      'GET /worlds/signs/leaderboard?limit=50': () =>
        ok(
          board({
            worldSlug: 'signs',
            participants: 2,
            entries: [entry(1, 'Ana', 300, true), entry(2, 'Luis', 50)],
            me: entry(1, 'Ana', 300, true),
          }),
        ),
    });
    renderApp('/clasificaciones/arithmetic');

    expect(await screen.findByText('Compañeros de tus grupos · Mundo 1')).toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Elige un mundo' }));
    expect(tabs.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/clasificaciones/arithmetic',
      '/clasificaciones/signs',
      '/clasificaciones/fractions',
      '/clasificaciones/algebra',
      '/clasificaciones/chaos',
    ]);

    await userEvent.click(tabs.getByRole('link', { name: /Números y signos/ }));

    expect(await screen.findByText('Compañeros de tus grupos · Mundo 2')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/clasificaciones/signs');
    expect(screen.getByRole('heading', { name: 'Exploradores de Números y signos' })).toBeInTheDocument();
    expect(screen.getByText('2 en la ruta')).toBeInTheDocument();
    expect(api.count('GET /worlds/signs/leaderboard?limit=50')).toBe(1);
    expect(api.count('GET /worlds')).toBe(1);
  });

  it('un mundo desconocido lo dice y permite volver a las clasificaciones', async () => {
    boardApi({ 'GET /worlds/arithmetic/leaderboard?limit=50': () => ok(board()) });
    renderApp('/clasificaciones/no-existe');

    expect(await screen.findByText('No encontramos ese mundo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver clasificaciones' }));
    expect(await screen.findByRole('heading', { name: 'Clasificaciones' })).toBeInTheDocument();
  });

  it('si falla la clasificación de un mundo, mantiene las pestañas y permite reintentar', async () => {
    boardApi({
      'GET /worlds/arithmetic/leaderboard?limit=50': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(board()),
      ),
    });
    renderApp('/clasificaciones');

    expect(await screen.findByRole('alert')).toHaveTextContent('Error interno del servidor.');
    expect(screen.getByRole('navigation', { name: 'Elige un mundo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Clasificaciones' })).toBeInTheDocument();
  });
});
