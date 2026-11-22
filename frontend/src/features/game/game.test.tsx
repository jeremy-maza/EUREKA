import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answer,
  arithmeticWorld,
  attempt,
  type Handler,
  mockApi,
  ok,
  progress,
  renderApp,
  rule2,
  rule7x1,
  sequence,
  signIn,
  student,
} from '@/test/utils';
import type { Rule } from '@/shared/api/types';

const rule5: Rule = { key: 'r5', type: 'FORBIDDEN_DIGIT', description: 'No puedes usar el dígito 5.' };

const session = (expiredAttempt: unknown = null) => ({
  status: 201,
  body: {
    session: { id: 's1', worldSlug: 'arithmetic', startedAt: '2026-11-21T10:00:00.000Z', endedAt: null },
    created: true,
    expiredAttempt,
  },
});

/** Rutas necesarias para entrar a jugar; `extra` añade o sustituye. */
function game(extra: Record<string, Handler>) {
  return mockApi({
    'GET /users/me': () => ok(student),
    'POST /worlds/arithmetic/sessions': () => session(),
    'GET /worlds/arithmetic/progress': () => ok(progress()),
    ...extra,
  });
}

const created = (body: unknown) => ({ status: 201, body });

const answerBox = () => screen.getByLabelText('Tu respuesta');
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
const activeRules = () => screen.getByRole('list', { name: 'Reglas activas' });
const scoreboard = () => screen.getByLabelText('Puntuación');

async function play(expression: string) {
  await userEvent.type(await screen.findByLabelText('Tu respuesta'), expression);
  await submit();
}

/**
 * El grillo salta tras un acierto y el siguiente reto se pide al aterrizar (`onAnimationEnd`). jsdom no ejecuta
 * animaciones CSS, así que se emite el fin del salto. React escucha `webkitAnimationEnd` en jsdom (no tiene
 * `AnimationEvent`), por eso se emiten ambos nombres: solo uno de ellos llega al manejador.
 */
async function finishJump() {
  const hopper = (await screen.findByAltText('Grillo saltando')).parentElement as HTMLElement;
  for (const type of ['animationend', 'webkitAnimationEnd']) {
    fireEvent(hopper, new Event(type, { bubbles: true }));
  }
}

beforeEach(() => signIn());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('entrada al juego', () => {
  it('muestra el reto, el tiempo y los puntos que decide el servidor (jugador nuevo, sin reglas)', async () => {
    const api = game({ 'POST /sessions/s1/attempts': () => created(attempt()) });
    renderApp('/juego');

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('01:00');
    expect(screen.getByLabelText('Progreso 1 de 4')).toBeInTheDocument();
    expect(within(activeRules()).queryAllByRole('listitem')).toHaveLength(0);
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*0/);
    expect(screen.queryByText('NUEVA REGLA')).not.toBeInTheDocument();
    // Orden de entrada: sesión → reto → progreso.
    expect(api.calls.map((call) => call.key).slice(1)).toEqual([
      'POST /worlds/arithmetic/sessions',
      'POST /sessions/s1/attempts',
      'GET /worlds/arithmetic/progress',
    ]);
  });

  it('muestra exactamente las reglas que envía el servidor y destaca la nueva', async () => {
    game({
      'POST /sessions/s1/attempts': () =>
        created(
          attempt({
            position: 3,
            expression: '3 * 7 * 2 / 6',
            timeLimitSeconds: 75,
            remainingMs: 75_000,
            rules: [rule2, rule7x1],
            newRule: rule7x1,
          }),
        ),
      'GET /worlds/arithmetic/progress': () =>
        ok(progress({ currentPosition: 3, totalPoints: 250, streak: 2, nextMultiplier: '2' })),
    });
    renderApp('/juego');

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7 × 2 ÷ 6' })).toBeInTheDocument();
    const items = within(activeRules()).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([rule2.description, rule7x1.description]);
    // La regla que llega como nueva se anuncia; la futura (dígito 5) no existe en pantalla.
    expect(screen.getByText('NUEVA REGLA')).toBeInTheDocument();
    expect(screen.queryByText(/dígito 5/)).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('01:15');
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*250/);
    expect(scoreboard()).toHaveTextContent(/RACHA\s*2/);
    expect(scoreboard()).toHaveTextContent(/PRÓXIMO\s*×2/);
  });

  it('avisa si un reto venció mientras el jugador estaba ausente', async () => {
    game({
      'POST /worlds/arithmetic/sessions': () => session({ attemptId: 'old', outcome: 'TIMEOUT' }),
      'POST /sessions/s1/attempts': () => created(attempt()),
    });
    renderApp('/juego');

    expect(await screen.findByText('TIEMPO AGOTADO')).toBeInTheDocument();
    expect(
      screen.getByText(/La secuencia se reinició; conservas tus puntos y tus reglas/),
    ).toBeInTheDocument();
  });
});

describe('acierto y progresión de reglas', () => {
  it('envía la expresión, actualiza puntos y racha, y el siguiente reto trae la regla nueva sin perder las anteriores', async () => {
    const api = game({
      'POST /sessions/s1/attempts': sequence(
        created(attempt()),
        created(
          attempt({
            attemptId: 'a2',
            position: 2,
            expression: '3 * 7 * 2',
            rules: [rule2],
            newRule: rule2,
          }),
        ),
      ),
      'POST /attempts/a1/answer': () => ok(answer()),
    });
    renderApp('/juego');

    await play('7 * 1 * 3');

    expect(api.bodies('POST /attempts/a1/answer')).toEqual([{ expression: '7 * 1 * 3' }]);
    await waitFor(() => expect(scoreboard()).toHaveTextContent(/PUNTOS\s*100/));
    expect(scoreboard()).toHaveTextContent(/RACHA\s*1/);
    expect(scoreboard()).toHaveTextContent(/PRÓXIMO\s*×1\.5/);
    // Mientras salta el grillo no se puede volver a responder.
    expect(answerBox()).toBeDisabled();

    await finishJump();

    expect(await screen.findByLabelText('Progreso 2 de 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operación 3 × 7 × 2' })).toBeInTheDocument();
    expect(within(activeRules()).getByText(rule2.description)).toBeInTheDocument();
    expect(screen.getByText('NUEVA REGLA')).toBeInTheDocument();
    expect(answerBox()).toHaveValue('');
    expect(answerBox()).toBeEnabled();
  });

  it('acumula reglas reto a reto: la anterior sigue activa cuando llega la siguiente', async () => {
    game({
      'POST /sessions/s1/attempts': sequence(
        created(attempt({ attemptId: 'a2', position: 2, rules: [rule2], newRule: rule2 })),
        created(
          attempt({
            attemptId: 'a3',
            position: 3,
            rules: [rule2, rule7x1],
            newRule: rule7x1,
            expression: '3 * 7 * 2 / 6',
          }),
        ),
      ),
      'POST /attempts/a2/answer': () => ok(answer({ attemptId: 'a2', unlockedRule: rule2 })),
    });
    renderApp('/juego');

    expect(await screen.findByLabelText('Progreso 2 de 4')).toBeInTheDocument();
    expect(within(activeRules()).getAllByRole('listitem')).toHaveLength(1);

    await play('7 * 1 * 6');
    await finishJump();

    expect(await screen.findByLabelText('Progreso 3 de 4')).toBeInTheDocument();
    const items = within(activeRules()).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([rule2.description, rule7x1.description]);
  });

  it('al completar el mundo lleva a la pantalla final con el resultado real', async () => {
    game({
      'POST /sessions/s1/attempts': () =>
        created(
          attempt({
            attemptId: 'a4',
            position: 4,
            expression: '5 * 8',
            rules: [rule2, rule7x1, rule5],
            newRule: rule5,
          }),
        ),
      'GET /worlds/arithmetic/progress': sequence(
        ok(progress({ currentPosition: 4 })),
        ok(progress({ status: 'COMPLETED', totalPoints: 1000, bestStreak: 4 })),
      ),
      'POST /attempts/a4/answer': () =>
        ok(answer({ attemptId: 'a4', worldCompleted: true, unlockedRule: rule5 })),
    });
    renderApp('/juego');

    await play('7 * 1 * 4 + 3 * 4');
    await finishJump();

    expect(await screen.findByRole('heading', { name: '¡Descubrimiento logrado!' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/final');
    expect(screen.getByText('1000')).toBeInTheDocument();
  });
});

describe('respuesta incorrecta y reinicio de la secuencia', () => {
  const violation = {
    ruleKey: 'r2',
    ruleType: 'FORBIDDEN_DIGIT',
    description: rule2.description,
    message: 'No puedes usar el dígito 2, pero aparece en el número 21.',
  };

  it('muestra el motivo y las reglas incumplidas, termina la secuencia y bloquea nuevas respuestas', async () => {
    game({
      'POST /sessions/s1/attempts': () =>
        created(attempt({ position: 2, expression: '3 * 7 * 2', rules: [rule2], newRule: rule2 })),
      'POST /attempts/a1/answer': () =>
        ok(
          answer({
            outcome: 'INCORRECT',
            failureReason: 'RULE_VIOLATION',
            message: 'No puedes usar el dígito 2, pero aparece en el número 21.',
            violations: [violation],
            score: { basePoints: 0, multiplierMilli: 0, multiplier: '0', points: 0 },
            sequenceRestarted: true,
            progress: progress({
              totalPoints: 450,
              bestStreak: 3,
              unlockedRules: [{ ...rule2, unlockedAt: '' }],
            }),
          }),
        ),
    });
    renderApp('/juego');

    await play('21 * 2');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '¡Secuencia terminada!' })).toBeInTheDocument();
    expect(within(dialog).getAllByText(/No puedes usar el dígito 2/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: /Reiniciar/ })).toBeInTheDocument();
    expect(answerBox()).toBeDisabled();
    // Fallar no borra los puntos históricos.
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*450/);
    expect(scoreboard()).toHaveTextContent(/RACHA\s*0/);
  });

  it('al reiniciar, el reto 1 vuelve con las reglas ya desbloqueadas (se conservan)', async () => {
    const api = game({
      'POST /sessions/s1/attempts': sequence(
        created(attempt({ position: 2, rules: [rule2], newRule: rule2 })),
        created(attempt({ attemptId: 'a2', position: 1, rules: [rule2], newRule: null })),
      ),
      'POST /attempts/a1/answer': () =>
        ok(
          answer({
            outcome: 'INCORRECT',
            failureReason: 'RULE_VIOLATION',
            message: 'Rompiste una regla.',
            violations: [violation],
            sequenceRestarted: true,
            progress: progress({ totalPoints: 100, unlockedRules: [{ ...rule2, unlockedAt: '' }] }),
          }),
        ),
    });
    renderApp('/juego');

    await play('21 * 2');
    await userEvent.click(await screen.findByRole('button', { name: /Reiniciar/ }));

    expect(await screen.findByLabelText('Progreso 1 de 4')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(activeRules()).getByText(rule2.description)).toBeInTheDocument();
    expect(screen.queryByText('NUEVA REGLA')).not.toBeInTheDocument();
    expect(answerBox()).toBeEnabled();
    // Reiniciar vuelve a pedir sesión y reto al servidor; el cliente no inventa estado.
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(2);
    expect(api.count('POST /sessions/s1/attempts')).toBe(2);
  });

  it('un resultado erróneo o una sintaxis inválida también terminan la secuencia con el mensaje del servidor', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () =>
        ok(
          answer({
            outcome: 'INCORRECT',
            failureReason: 'WRONG_RESULT',
            message: 'Tu expresión vale 22, pero el resultado esperado es 21.',
            sequenceRestarted: true,
          }),
        ),
    });
    renderApp('/juego');

    await play('22');

    expect(
      await screen.findByText('Tu expresión vale 22, pero el resultado esperado es 21.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '¡Secuencia terminada!' })).toBeInTheDocument();
  });
});

describe('tiempo agotado', () => {
  it('al llegar el tiempo local a 0 pregunta al servidor; si cerró el reto, muestra el fin y no envía la respuesta', async () => {
    const api = game({
      'POST /sessions/s1/attempts': () => created(attempt({ remainingMs: 200 })),
      'GET /sessions/s1/attempts/current': () => ({
        status: 404,
        body: { message: 'No hay un reto en curso.' },
      }),
    });
    renderApp('/juego');

    const dialog = await screen.findByRole('dialog', {}, { timeout: 4000 });
    expect(within(dialog).getByRole('heading', { name: '¡Tiempo agotado!' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Reiniciar/ })).toBeInTheDocument();
    expect(api.count('GET /sessions/s1/attempts/current')).toBe(1);
    expect(api.count('POST /attempts/a1/answer')).toBe(0);
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
  });

  it('el reloj local es solo informativo: si el servidor dice que aún hay tiempo, el reto sigue abierto', async () => {
    const api = game({
      'POST /sessions/s1/attempts': () => created(attempt({ remainingMs: 200 })),
      'GET /sessions/s1/attempts/current': () => ok(attempt({ remainingMs: 60_000, resumed: true })),
    });
    renderApp('/juego');

    await waitFor(() => expect(api.count('GET /sessions/s1/attempts/current')).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('01:00'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(answerBox()).toBeEnabled();
  });

  it('un envío fuera de plazo se muestra como tiempo agotado (decide el servidor)', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () =>
        ok(
          answer({
            outcome: 'TIMEOUT',
            failureReason: 'TIMEOUT',
            message: 'Se acabó el tiempo.',
            evaluatedValue: null,
            sequenceRestarted: true,
          }),
        ),
    });
    renderApp('/juego');

    await play('7 * 1 * 3');

    expect(await screen.findByRole('heading', { name: '¡Tiempo agotado!' })).toBeInTheDocument();
    expect(screen.getByText('Se acabó el tiempo.')).toBeInTheDocument();
  });
});

describe('errores de la API y validación', () => {
  it('muestra el error al cargar y permite reintentar hasta entrar', async () => {
    const api = game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'GET /worlds/arithmetic/progress': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(progress()),
      ),
    });
    renderApp('/juego');

    expect(await screen.findByText('No pudimos cargar el juego')).toBeInTheDocument();
    expect(screen.getByText('Error interno del servidor.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(2);
  });

  it('si no hay mundo disponible, ofrece volver al inicio', async () => {
    game({
      'POST /worlds/arithmetic/sessions': () => ({
        status: 404,
        body: { message: 'El mundo "arithmetic" no existe.' },
      }),
      'GET /worlds': () => ok([arithmeticWorld]),
      'GET /progress': () => ok([progress()]),
    });
    renderApp('/juego');

    expect(await screen.findByText('El mundo "arithmetic" no existe.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Volver al inicio' }));
    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
  });

  it('un error del servidor al responder se muestra en el formulario y el reto sigue abierto', async () => {
    const api = game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(answer()),
      ),
    });
    renderApp('/juego');

    await play('7 * 1 * 3');
    expect(await screen.findByRole('alert')).toHaveTextContent('Error interno del servidor.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(answerBox()).toBeEnabled();
    expect(answerBox()).toHaveValue('7 * 1 * 3');

    await submit();
    await waitFor(() => expect(scoreboard()).toHaveTextContent(/PUNTOS\s*100/));
    expect(api.count('POST /attempts/a1/answer')).toBe(2);
  });

  it('sin conexión al responder, avisa sin perder lo escrito', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
    });
    renderApp('/juego');
    await screen.findByRole('heading', { name: 'Operación 3 × 7' });

    // A partir de aquí cae la red.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    await play('7 * 1 * 3');

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor');
    expect(answerBox()).toHaveValue('7 * 1 * 3');
  });

  it('si el reto ya se resolvió en otra pestaña (409), se vuelve a sincronizar con el servidor', async () => {
    const api = game({
      'POST /sessions/s1/attempts': sequence(
        created(attempt()),
        created(
          attempt({ attemptId: 'a2', position: 2, rules: [rule2], newRule: rule2, expression: '3 * 7 * 2' }),
        ),
      ),
      'POST /attempts/a1/answer': () => ({
        status: 409,
        body: { message: 'Este reto ya fue resuelto con otra respuesta; solo hay un intento por reto.' },
      }),
    });
    renderApp('/juego');

    await play('7 * 1 * 3');

    expect(await screen.findByLabelText('Progreso 2 de 4')).toBeInTheDocument();
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('una respuesta vacía no llega al servidor y marca el campo como inválido', async () => {
    const api = game({ 'POST /sessions/s1/attempts': () => created(attempt()) });
    renderApp('/juego');
    await screen.findByRole('heading', { name: 'Operación 3 × 7' });

    await submit();

    expect(answerBox()).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls.some((call) => call.key.includes('/answer'))).toBe(false);

    await userEvent.type(answerBox(), '1');
    expect(answerBox()).toHaveAttribute('aria-invalid', 'false');
  });

  it('recorta los espacios de la expresión que envía', async () => {
    const api = game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () => ok(answer()),
    });
    renderApp('/juego');

    await play('   7 * 1 * 3  ');

    await waitFor(() =>
      expect(api.bodies('POST /attempts/a1/answer')).toEqual([{ expression: '7 * 1 * 3' }]),
    );
  });
});

describe('pantalla final', () => {
  it('sin un mundo completado no hay resultado: vuelve al inicio', async () => {
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds/arithmetic/progress': () => ok(progress({ status: 'IN_PROGRESS' })),
      'GET /worlds': () => ok([arithmeticWorld]),
      'GET /progress': () => ok([progress()]),
    });
    renderApp('/final');

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('con el mundo completado muestra puntos y mejor racha reales y permite volver a jugar', async () => {
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds/arithmetic/progress': () =>
        ok(progress({ status: 'COMPLETED', totalPoints: 2200, bestStreak: 8, currentPosition: 5 })),
      'POST /worlds/arithmetic/sessions': () => session(),
      'POST /sessions/s1/attempts': () => created(attempt({ rules: [rule2, rule7x1, rule5] })),
    });
    renderApp('/final');

    expect(await screen.findByRole('heading', { name: '¡Descubrimiento logrado!' })).toBeInTheDocument();
    expect(screen.getByText('2200')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Volver a jugar/ }));

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(within(activeRules()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('muestra el error si no se puede cargar el resultado', async () => {
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds/arithmetic/progress': () => ({
        status: 500,
        body: { message: 'Error interno del servidor.' },
      }),
    });
    renderApp('/final');

    expect(await screen.findByText('No pudimos cargar tu resultado')).toBeInTheDocument();
    expect(screen.getByText('Error interno del servidor.')).toBeInTheDocument();
  });
});
