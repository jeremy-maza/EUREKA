import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allWorlds,
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
  worldsProgress,
} from '@/test/utils';

function home(extra: Record<string, Handler> = {}) {
  return mockApi({
    'GET /users/me': () => ok(student),
    'GET /worlds': () => ok(allWorlds),
    'GET /progress': () => ok(worldsProgress()),
    ...extra,
  });
}

/** Tarjeta (<article>) de un mundo del mapa, por su nombre. */
const worldCard = async (name: string) =>
  (await screen.findByRole('heading', { name })).closest('article') as HTMLElement;

beforeEach(() => signIn());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('inicio: mapa de mundos', () => {
  it('muestra los cinco mundos en orden de posición', async () => {
    home();
    renderApp('/');

    const map = await screen.findByRole('list', { name: 'Mapa de mundos' });
    expect(
      within(map)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Aritmética', 'Números y signos', 'Fracciones y decimales', 'Álgebra', 'Caos matemático']);
  });

  it('jugador nuevo: Mundo 1 disponible con «Jugar»; los demás bloqueados con el mundo que hay que completar', async () => {
    home();
    renderApp('/');

    const first = await worldCard('Aritmética');
    expect(first).toHaveAttribute('data-status', 'available');
    expect(first).toHaveTextContent('Disponible');
    expect(within(first).getByRole('link', { name: 'Jugar: Mundo 1' })).toHaveAttribute(
      'href',
      '/juego/arithmetic',
    );
    expect(first).toHaveTextContent('6 reglas por dominar');
    expect(within(first).getByRole('list', { name: 'Conceptos de Aritmética' })).toHaveTextContent(
      'Cuatro operaciones',
    );

    const second = await worldCard('Números y signos');
    expect(second).toHaveAttribute('data-status', 'locked');
    expect(second).toHaveTextContent('Bloqueado');
    expect(second).toHaveTextContent('Completa el Mundo 1 (Aritmética) para desbloquear.');
    expect(within(second).queryByRole('link')).not.toBeInTheDocument();

    const chaos = await worldCard('Caos matemático');
    expect(chaos).toHaveTextContent('Completa el Mundo 4 (Álgebra) para desbloquear.');
  });

  it('en curso: puntos, rachas, reglas dominadas x / N, posición y dificultad de la secuencia activa', async () => {
    home({
      'GET /progress': () =>
        ok(
          worldsProgress({
            currentPosition: 3,
            totalPoints: 450,
            streak: 3,
            bestStreak: 4,
            unlockedRules: [{ ...rule2, unlockedAt: '2026-11-21T10:00:00.000Z' }],
            activeSequence: { id: 'q1', difficulty: 'HARDER', challengeCount: 5, rules: [rule2] },
            statistics: { ...progress().statistics, attemptsCount: 4 },
          }),
        ),
    });
    renderApp('/');

    const world = await worldCard('Aritmética');
    expect(world).toHaveAttribute('data-status', 'in-progress');
    expect(world).toHaveTextContent(/Puntos\s*450/);
    expect(world).toHaveTextContent(/Racha\s*3/);
    expect(world).toHaveTextContent(/Mejor racha\s*4/);
    expect(world).toHaveTextContent(/Reglas dominadas\s*1\s*\/\s*6/);
    expect(world).toHaveTextContent(/desafío\s*3\s*de\s*5/);
    expect(within(world).getByText('Intensa')).toBeInTheDocument();
    expect(within(world).getByRole('link', { name: 'Continuar: Mundo 1' })).toBeInTheDocument();
  });

  it('completado: insignia, veces completado, jugar de nuevo y el siguiente mundo desbloqueado', async () => {
    home({
      'GET /progress': () =>
        ok([
          progress({
            status: 'COMPLETED',
            completionsCount: 2,
            statistics: { ...progress().statistics, attemptsCount: 9 },
          }),
          progress({ worldSlug: 'signs' }),
          ...worldsProgress().slice(2),
        ]),
    });
    renderApp('/');

    const first = await worldCard('Aritmética');
    expect(first).toHaveAttribute('data-status', 'completed');
    expect(first).toHaveTextContent('Completado 2 veces');
    expect(within(first).getByRole('link', { name: 'Jugar de nuevo: Mundo 1' })).toBeInTheDocument();

    const second = await worldCard('Números y signos');
    expect(second).toHaveAttribute('data-status', 'available');
    expect(within(second).getByRole('link', { name: 'Jugar: Mundo 2' })).toHaveAttribute(
      'href',
      '/juego/signs',
    );
    expect(await worldCard('Fracciones y decimales')).toHaveAttribute('data-status', 'locked');
  });

  it('Jugar lleva a la partida del mundo', async () => {
    home({
      'POST /worlds/arithmetic/sessions': () => ({
        status: 201,
        body: { session: { id: 's1', worldSlug: 'arithmetic' }, created: true, expiredAttempt: null },
      }),
      'POST /sessions/s1/attempts': sequence({ status: 201, body: attempt() }),
      'GET /worlds/arithmetic/progress': () => ok(progress()),
    });
    renderApp('/');

    await userEvent.click(await screen.findByRole('link', { name: 'Jugar: Mundo 1' }));
    // El reto no empieza hasta que el jugador lo pide.
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar desafío' }));

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/juego/arithmetic');
  });

  it('enlaza con Mi progreso y con Clasificaciones', async () => {
    home({
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

  it('si el servidor no informa de un mundo en el progreso, no lo bloquea por su cuenta', async () => {
    home({ 'GET /worlds': () => ok([arithmeticWorld]), 'GET /progress': () => ok([]) });
    renderApp('/');

    const world = await worldCard('Aritmética');
    expect(world).toHaveAttribute('data-status', 'available');
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
        ok(worldsProgress()),
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
