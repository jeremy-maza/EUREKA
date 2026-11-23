import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, ok, renderApp, sequence, signIn, student } from '@/test/utils';
import type { Leaderboard } from '@/shared/api/types';

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

beforeEach(() => signIn());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('clasificaciones', () => {
  it('muestra la clasificación del grupo con el puesto del propio jugador resaltado', async () => {
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds/arithmetic/leaderboard?limit=50': () => ok(board()),
    });
    renderApp('/clasificaciones');

    expect(await screen.findByRole('heading', { name: 'Clasificaciones' })).toBeInTheDocument();
    expect(screen.getByText('Compañeros de tus grupos · Mundo 1')).toBeInTheDocument();
    expect(screen.getByText('3 en la ruta')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: '' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Ana');
    expect(rows[1]).toHaveTextContent('Tu recorrido');
    expect(rows[1]).toHaveTextContent('450');
  });

  it('sin grupo explica cómo compararse con compañeros', async () => {
    const me = entry(1, 'Ana', 0, true);
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds/arithmetic/leaderboard?limit=50': () =>
        ok(board({ scope: 'SELF', participants: 1, entries: [me], me })),
    });
    renderApp('/clasificaciones');

    expect(await screen.findByText(/Aún no perteneces a un grupo/)).toBeInTheDocument();
  });

  it('si el jugador queda fuera del recorte de la lista, se añade al final', async () => {
    const me = entry(60, 'Ana', 5, true);
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds/arithmetic/leaderboard?limit=50': () =>
        ok(board({ participants: 60, entries: [entry(1, 'Luis', 900), entry(2, 'Marta', 800)], me })),
    });
    renderApp('/clasificaciones');

    await screen.findByRole('heading', { name: 'Clasificaciones' });
    const rows = screen.getAllByRole('listitem').filter((item) => item.textContent?.includes('pts'));
    expect(rows.at(-1)).toHaveTextContent('Ana');
    expect(rows.at(-1)).toHaveTextContent('60');
  });

  it('muestra el error y permite reintentar', async () => {
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds/arithmetic/leaderboard?limit=50': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(board()),
      ),
    });
    renderApp('/clasificaciones');

    expect(await screen.findByText('No pudimos cargar la clasificación')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Clasificaciones' })).toBeInTheDocument();
  });
});
