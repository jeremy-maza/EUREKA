import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  algebraWorld,
  allWorlds,
  answer,
  attempt,
  fractionsWorld,
  type Handler,
  historyItem,
  lockedProgress,
  mockApi,
  ok,
  progress,
  renderApp,
  rule2,
  rule5,
  rule7x1,
  sequence,
  signIn,
  signsWorld,
  student,
  worldsProgress,
} from '@/test/utils';
import type { AnswerResult, Rule } from '@/services/api/types';

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
    'GET /worlds': () => ok(allWorlds),
    'POST /worlds/arithmetic/sessions': () => session(),
    'GET /worlds/arithmetic/progress': () => ok(progress()),
    ...extra,
  });
}

const created = (body: unknown) => ({ status: 201, body });

/** Historial en el que el servidor ya cerró por tiempo el reto `a1`. */
const timeoutHistory = (attemptId = 'a1') => ({
  items: [
    historyItem({
      attemptId,
      outcome: 'TIMEOUT',
      failureReason: 'TIMEOUT',
      submission: null,
      evaluatedValue: null,
      pointsAwarded: 0,
    }),
  ],
  nextCursor: null,
});

const answerBox = () => screen.getByLabelText('Tu respuesta');
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
const activeRules = () => screen.getByRole('list', { name: 'Reglas activas' });
/** Descripciones de las reglas activas (sin etiquetas como "Nueva"). */
const ruleTexts = () =>
  within(activeRules())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('span')?.textContent);
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
    renderApp('/juego/arithmetic');

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('01:00');
    expect(screen.getByLabelText('Progreso 1 de 4')).toBeInTheDocument();
    expect(within(activeRules()).queryAllByRole('listitem')).toHaveLength(0);
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*0/);
    expect(screen.queryByText('NUEVA REGLA')).not.toBeInTheDocument();
    // Orden de entrada: mundos → sesión → reto → progreso.
    expect(api.calls.map((call) => call.key).slice(1)).toEqual([
      'GET /worlds',
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
    renderApp('/juego/arithmetic');

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7 × 2 ÷ 6' })).toBeInTheDocument();
    expect(ruleTexts()).toEqual([rule2.description, rule7x1.description]);
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
    renderApp('/juego/arithmetic');

    expect(await screen.findByText('TIEMPO AGOTADO')).toBeInTheDocument();
    const notice = screen.getByText(/Tu reto anterior venció/);
    expect(notice).toHaveTextContent('sus reglas se descartaron');
    expect(notice).toHaveTextContent('conservas tus puntos y tus reglas dominadas');
    expect(notice).not.toHaveTextContent(/conservas tus reglas\b(?! dominadas)/);
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
    renderApp('/juego/arithmetic');

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
    renderApp('/juego/arithmetic');

    expect(await screen.findByLabelText('Progreso 2 de 4')).toBeInTheDocument();
    expect(within(activeRules()).getAllByRole('listitem')).toHaveLength(1);

    await play('7 * 1 * 6');
    await finishJump();

    expect(await screen.findByLabelText('Progreso 3 de 4')).toBeInTheDocument();
    expect(ruleTexts()).toEqual([rule2.description, rule7x1.description]);
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
      'GET /worlds/arithmetic/progress': () => ok(progress({ currentPosition: 4 })),
      'GET /progress': () =>
        ok(worldsProgress({ status: 'COMPLETED', completionsCount: 1, totalPoints: 1000, bestStreak: 4 })),
      'POST /attempts/a4/answer': () =>
        ok(answer({ attemptId: 'a4', worldCompleted: true, unlockedRule: rule5 })),
    });
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 4 + 3 * 4');
    await finishJump();

    expect(await screen.findByRole('heading', { name: '¡Descubrimiento logrado!' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/final/arithmetic');
    expect(screen.getByText('1000')).toBeInTheDocument();
    // El Mundo 2 sigue bloqueado según el servidor: no se ofrece ir a él.
    expect(screen.queryByRole('button', { name: /Ir al Mundo/ })).not.toBeInTheDocument();
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
    renderApp('/juego/arithmetic');

    await play('21 * 2');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '¡Secuencia terminada!' })).toBeInTheDocument();
    expect(within(dialog).getAllByText(/No puedes usar el dígito 2/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Nueva secuencia' })).toBeInTheDocument();
    expect(answerBox()).toBeDisabled();
    // Fallar no borra los puntos históricos.
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*450/);
    expect(scoreboard()).toHaveTextContent(/RACHA\s*0/);
  });

  it('la nueva secuencia empieza en el reto 1 con las reglas que sortee el servidor (no las descartadas)', async () => {
    const api = game({
      'POST /sessions/s1/attempts': sequence(
        created(attempt({ position: 2, rules: [rule2], newRule: rule2 })),
        created(attempt({ attemptId: 'a2', sequenceId: 'q2', position: 1, rules: [], newRule: null })),
      ),
      'POST /attempts/a1/answer': () =>
        ok(
          answer({
            outcome: 'INCORRECT',
            failureReason: 'RULE_VIOLATION',
            message: 'Rompiste una regla.',
            violations: [violation],
            sequenceRestarted: true,
            discardedRules: [rule2],
            progress: progress({ totalPoints: 100, unlockedRules: [{ ...rule2, unlockedAt: '' }] }),
          }),
        ),
    });
    renderApp('/juego/arithmetic');

    await play('21 * 2');
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva secuencia' }));

    expect(await screen.findByLabelText('Progreso 1 de 4')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(activeRules()).queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByText('NUEVA REGLA')).not.toBeInTheDocument();
    expect(answerBox()).toBeEnabled();
    // Reiniciar vuelve a pedir sesión y reto al servidor; el cliente no inventa estado.
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(2);
    expect(api.count('POST /sessions/s1/attempts')).toBe(2);
  });

  it('un resultado erróneo termina la secuencia sin revelar el resultado esperado', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () =>
        ok(
          answer({
            outcome: 'INCORRECT',
            failureReason: 'WRONG_RESULT',
            message: 'Tu expresión vale 22, pero el resultado esperado es 21.',
            evaluatedValue: '22',
            sequenceRestarted: true,
          }),
        ),
    });
    renderApp('/juego/arithmetic');

    await play('22');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '¡Secuencia terminada!' })).toBeInTheDocument();
    expect(
      within(dialog).getByText('Tu expresión vale 22, pero no da el mismo resultado que el desafío.'),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/esperado/);
    expect(dialog).not.toHaveTextContent('21');
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
      'GET /worlds/arithmetic/attempts?limit=1': () => ok(timeoutHistory()),
    });
    renderApp('/juego/arithmetic');

    const dialog = await screen.findByRole('dialog', {}, { timeout: 4000 });
    expect(within(dialog).getByRole('heading', { name: '¡Tiempo agotado!' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Nueva secuencia' })).toBeInTheDocument();
    expect(api.count('GET /sessions/s1/attempts/current')).toBe(1);
    expect(api.count('POST /attempts/a1/answer')).toBe(0);
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
  });

  it('el reloj local es solo informativo: si el servidor dice que aún hay tiempo, el reto sigue abierto', async () => {
    const api = game({
      'POST /sessions/s1/attempts': () => created(attempt({ remainingMs: 200 })),
      'GET /sessions/s1/attempts/current': () => ok(attempt({ remainingMs: 60_000, resumed: true })),
    });
    renderApp('/juego/arithmetic');

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
    renderApp('/juego/arithmetic');

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
    renderApp('/juego/arithmetic');

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
      'GET /progress': () => ok(worldsProgress()),
    });
    renderApp('/juego/arithmetic');

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
    renderApp('/juego/arithmetic');

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
    renderApp('/juego/arithmetic');
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
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 3');

    expect(await screen.findByLabelText('Progreso 2 de 4')).toBeInTheDocument();
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('una respuesta vacía no llega al servidor y marca el campo como inválido', async () => {
    const api = game({ 'POST /sessions/s1/attempts': () => created(attempt()) });
    renderApp('/juego/arithmetic');
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
    renderApp('/juego/arithmetic');

    await play('   7 * 1 * 3  ');

    await waitFor(() =>
      expect(api.bodies('POST /attempts/a1/answer')).toEqual([{ expression: '7 * 1 * 3' }]),
    );
  });
});

describe('pantalla final', () => {
  const finalApi = (extra: Record<string, Handler> = {}) =>
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'GET /progress': () => ok(worldsProgress()),
      ...extra,
    });

  it('sin un mundo completado no hay resultado: vuelve al inicio', async () => {
    finalApi();
    renderApp('/final/arithmetic');

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('/final sin mundo vuelve al mapa', async () => {
    finalApi();
    renderApp('/final');

    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
  });

  it('con el mundo completado muestra puntos, mejor racha y reglas dominadas reales y permite jugar de nuevo', async () => {
    finalApi({
      'GET /progress': () =>
        ok(
          worldsProgress({
            status: 'COMPLETED',
            completionsCount: 2,
            totalPoints: 2200,
            bestStreak: 8,
            unlockedRules: [unlocked(rule2), unlocked(rule7x1)],
          }),
        ),
      'POST /worlds/arithmetic/sessions': () => session(),
      'GET /worlds/arithmetic/progress': () => ok(progress()),
      'POST /sessions/s1/attempts': () => created(attempt({ rules: [rule2, rule7x1, rule5] })),
    });
    renderApp('/final/arithmetic');

    expect(await screen.findByRole('heading', { name: '¡Descubrimiento logrado!' })).toBeInTheDocument();
    expect(screen.getByText(/MUNDO 1 COMPLETADO/)).toBeInTheDocument();
    expect(screen.getByText('2200')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText(/Reglas dominadas/).parentElement).toHaveTextContent(/2\s*\/\s*6/);
    expect(screen.getByText(/Veces completado/).parentElement).toHaveTextContent('2');

    await userEvent.click(screen.getByRole('button', { name: /Jugar de nuevo/ }));

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/juego/arithmetic');
    expect(within(activeRules()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('si el siguiente mundo ya está desbloqueado ofrece ir a él', async () => {
    finalApi({
      'GET /progress': () =>
        ok([
          progress({ status: 'COMPLETED', completionsCount: 1 }),
          progress({ worldSlug: 'signs' }),
          ...worldsProgress().slice(2),
        ]),
      'POST /worlds/signs/sessions': () => session(),
      'POST /sessions/s1/attempts': () =>
        created(attempt({ worldSlug: 'signs', expression: '-3 * 4', difficulty: 'EASIER' })),
      'GET /worlds/signs/progress': () => ok(progress({ worldSlug: 'signs' })),
    });
    renderApp('/final/arithmetic');

    await userEvent.click(await screen.findByRole('button', { name: /Ir al Mundo 2/ }));

    expect(await screen.findByRole('heading', { name: 'Operación -3 × 4' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/juego/signs');
    expect(screen.getByText('Números y signos')).toBeInTheDocument();
  });

  it('un mundo desconocido lo dice y permite volver al mapa', async () => {
    finalApi();
    renderApp('/final/no-existe');

    expect(await screen.findByText('No encontramos ese mundo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Volver al mapa' }));
    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
  });

  it('muestra el error si no se puede cargar el resultado', async () => {
    finalApi({
      'GET /progress': () => ({ status: 500, body: { message: 'Error interno del servidor.' } }),
    });
    renderApp('/final/arithmetic');

    expect(await screen.findByText('No pudimos cargar tu resultado')).toBeInTheDocument();
    expect(screen.getByText('Error interno del servidor.')).toBeInTheDocument();
  });
});

describe('mundo completado en la partida', () => {
  it('celebra el desbloqueo del siguiente mundo y ofrece "Ir al Mundo 2"', async () => {
    game({
      'POST /sessions/s1/attempts': () =>
        created(attempt({ attemptId: 'a4', position: 4, rules: [rule2, rule7x1, rule5], newRule: rule5 })),
      'POST /attempts/a4/answer': () =>
        ok(
          answer({
            attemptId: 'a4',
            worldCompleted: true,
            nextWorldUnlocked: { slug: 'signs', name: 'Números y signos', position: 2 },
          }),
        ),
      'GET /progress': () =>
        ok([
          progress({ status: 'COMPLETED', completionsCount: 1, totalPoints: 900 }),
          progress({ worldSlug: 'signs' }),
          ...worldsProgress().slice(2),
        ]),
    });
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 4 + 3 * 4');
    const note = await screen.findByRole('status', { name: 'Resultado del intento' });
    expect(note).toHaveTextContent('¡Completaste el Mundo 1!');
    expect(note).toHaveTextContent('Desbloqueaste el Mundo 2: Números y signos.');
    await finishJump();

    expect(
      await screen.findByText(/¡Nuevo mundo desbloqueado! Mundo 2:\s*Números y signos/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ir al Mundo 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jugar de nuevo/ })).toBeInTheDocument();
  });
});

describe('mundo por slug', () => {
  it('juega en el mundo de la URL: cabecera con su número y nombre, sesión y progreso de ese mundo', async () => {
    const api = mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'POST /worlds/fractions/sessions': () => session(),
      'POST /sessions/s1/attempts': () =>
        created(
          attempt({
            worldSlug: 'fractions',
            expression: '1/2 + 1/4',
            syntax: fractionsWorld.syntax,
            difficulty: 'HARDER',
            instruction: 'Escribe una expresión que valga lo mismo usando decimales o fracciones.',
          }),
        ),
      'GET /worlds/fractions/progress': () => ok(progress({ worldSlug: 'fractions' })),
    });
    renderApp('/juego/fractions');

    expect(await screen.findByRole('heading', { name: 'Operación 1÷2 + 1÷4' })).toBeInTheDocument();
    expect(screen.getByText('MUNDO 3')).toBeInTheDocument();
    expect(screen.getByText('Fracciones y decimales')).toBeInTheDocument();
    expect(
      screen.getByText('Escribe una expresión que valga lo mismo usando decimales o fracciones.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Intensa')).toBeInTheDocument();
    expect(screen.getByText('Dificultad:', { exact: false })).toBeInTheDocument();
    const symbols = within(screen.getByRole('list', { name: 'Símbolos permitidos' }));
    expect(symbols.getByText('decimales')).toBeInTheDocument();
    expect(symbols.queryByText('potencias')).not.toBeInTheDocument();
    expect(api.count('POST /worlds/fractions/sessions')).toBe(1);
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(0);
  });

  it('ecuación: se muestra «Resuelve:», la respuesta vale x y se indican las potencias', async () => {
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'POST /worlds/algebra/sessions': () => session(),
      'POST /sessions/s1/attempts': () =>
        created(
          attempt({
            worldSlug: 'algebra',
            statementKind: 'EQUATION',
            expression: '3 * x + 4 = 19',
            instruction: 'Resuelve la ecuación: escribe una expresión que valga x.',
            syntax: algebraWorld.syntax,
          }),
        ),
      'GET /worlds/algebra/progress': () => ok(progress({ worldSlug: 'algebra' })),
    });
    renderApp('/juego/algebra');

    const heading = await screen.findByRole('heading', { name: 'Resuelve: 3 × x + 4 = 19' });
    expect(heading).toHaveTextContent('Resuelve:3 × x + 4 = 19');
    expect(screen.getByText('ECUACIÓN')).toBeInTheDocument();
    expect(screen.getByText('Tu respuesta es una expresión cuyo valor es x.')).toBeInTheDocument();
    expect(answerBox()).toHaveAttribute('placeholder', 'Una expresión que valga x');
    expect(answerBox().getAttribute('aria-describedby')).toContain('equation-hint');
    const symbols = within(screen.getByRole('list', { name: 'Símbolos permitidos' }));
    expect(symbols.getByText('^')).toBeInTheDocument();
    expect(symbols.getByText('potencias')).toBeInTheDocument();
    expect(symbols.queryByText('decimales')).not.toBeInTheDocument();
    // Nunca se muestra la solución.
    expect(document.body).not.toHaveTextContent(/x\s*=\s*5/);
  });

  it('el campo acepta los símbolos del servidor sin filtrarlos (valida el servidor)', async () => {
    const api = mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'POST /worlds/chaos/sessions': () => session(),
      'POST /sessions/s1/attempts': () =>
        created(attempt({ worldSlug: 'chaos', syntax: { decimals: true, powers: true } })),
      'GET /worlds/chaos/progress': () => ok(progress({ worldSlug: 'chaos' })),
      'POST /attempts/a1/answer': () => ok(answer()),
    });
    renderApp('/juego/chaos');

    await play('(2,5 × 2) ^ 2 − 4 ÷ 1.0 = 21');

    await waitFor(() =>
      expect(api.bodies('POST /attempts/a1/answer')).toEqual([
        { expression: '(2,5 × 2) ^ 2 − 4 ÷ 1.0 = 21' },
      ]),
    );
  });

  it('un mundo bloqueado (403) explica qué mundo completar y ofrece ir a él', async () => {
    const api = mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'POST /worlds/fractions/sessions': () => ({
        status: 403,
        body: { message: 'Completa el Mundo 2 (Números y signos) para desbloquear este mundo.' },
      }),
      'GET /worlds/fractions/progress': () => ok(lockedProgress(fractionsWorld, signsWorld)),
      'POST /worlds/signs/sessions': () => session(),
      'POST /sessions/s1/attempts': () => created(attempt({ worldSlug: 'signs' })),
      'GET /worlds/signs/progress': () => ok(progress({ worldSlug: 'signs' })),
    });
    renderApp('/juego/fractions');

    expect(await screen.findByRole('heading', { name: 'El Mundo 3 está bloqueado' })).toBeInTheDocument();
    expect(
      screen.getByText('Completa el Mundo 2 (Números y signos) para desbloquear este mundo.'),
    ).toBeInTheDocument();
    expect(api.count('POST /sessions/s1/attempts')).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Ir al Mundo 2' }));

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/juego/signs');
    expect(screen.getByText('Números y signos')).toBeInTheDocument();
  });

  it('un mundo que no existe no abre sesión y permite volver al mapa', async () => {
    const api = mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'GET /progress': () => ok(worldsProgress()),
    });
    renderApp('/juego/no-existe');

    expect(await screen.findByRole('heading', { name: 'No encontramos ese mundo' })).toBeInTheDocument();
    expect(api.calls.some((call) => call.key.includes('/sessions'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Volver al mapa' }));
    expect(await screen.findByRole('heading', { name: '¡Hola, Ana!' })).toBeInTheDocument();
  });
});

describe('/juego sin mundo', () => {
  const play = (progressList: unknown) =>
    mockApi({
      'GET /users/me': () => ok(student),
      'GET /worlds': () => ok(allWorlds),
      'GET /progress': () => ok(progressList),
      'POST /worlds/arithmetic/sessions': () => session(),
      'POST /worlds/signs/sessions': () => session(),
      'POST /sessions/s1/attempts': () => created(attempt()),
      'GET /worlds/arithmetic/progress': () => ok(progress()),
      'GET /worlds/signs/progress': () => ok(progress({ worldSlug: 'signs' })),
    });

  it('lleva al primer mundo desbloqueado y sin completar', async () => {
    play([
      progress({ status: 'COMPLETED', completionsCount: 1 }),
      progress({ worldSlug: 'signs' }),
      ...worldsProgress().slice(2),
    ]);
    renderApp('/juego');

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/juego/signs');
  });

  it('si todos los desbloqueados están completados, lleva a Aritmética', async () => {
    play([progress({ status: 'COMPLETED', completionsCount: 3 }), ...worldsProgress().slice(1)]);
    renderApp('/juego');

    expect(await screen.findByRole('heading', { name: 'Operación 3 × 7' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/juego/arithmetic');
  });
});

// ───────────── Fixtures de fallo ─────────────

const unlocked = (rule: Rule) => ({ ...rule, unlockedAt: '2026-11-20T10:00:00.000Z' });
const violation2 = {
  ruleKey: 'r2',
  ruleType: 'FORBIDDEN_DIGIT',
  description: rule2.description,
  message: 'No puedes usar el dígito 2, pero aparece en el número 21.',
};

/** Fallo que el servidor ya liquidó: puntos y reglas dominadas conservados, racha a 0, reglas descartadas. */
function failed(over: Partial<AnswerResult> = {}): AnswerResult {
  return answer({
    outcome: 'INCORRECT',
    failureReason: 'WRONG_RESULT',
    message: 'Tu expresión vale 22, pero el resultado esperado es 21.',
    evaluatedValue: '22',
    score: { basePoints: 0, multiplierMilli: 0, multiplier: '0', points: 0 },
    sequenceRestarted: true,
    discardedRules: [rule2],
    progress: progress({ totalPoints: 450, streak: 0, bestStreak: 3, unlockedRules: [unlocked(rule2)] }),
    ...over,
  });
}

const dialogOf = async () => screen.findByRole('dialog');

describe('fallo: se descartan las reglas de la secuencia', () => {
  it('lista las reglas descartadas y lo que se conserva; no promete conservar las reglas de la secuencia', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt({ position: 2, rules: [rule2], newRule: rule2 })),
      'POST /attempts/a1/answer': () => ok(failed({ discardedRules: [rule2, rule7x1] })),
    });
    renderApp('/juego/arithmetic');

    await play('22');

    const dialog = await dialogOf();
    const discarded = within(within(dialog).getByRole('list', { name: 'Reglas descartadas' }));
    expect(discarded.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      rule2.description,
      rule7x1.description,
    ]);
    const info = within(dialog).getByLabelText('Qué conservas');
    expect(info).toHaveTextContent(/Tus puntos:\s*450/);
    expect(info).toHaveTextContent(/Tus reglas dominadas:\s*1 de 6/);
    expect(info).toHaveTextContent(/Tu racha vuelve a empezar:\s*0/);
    expect(info).toHaveTextContent(
      'La próxima secuencia sorteará reglas nuevas y empezará desde el desafío 1.',
    );
    // La copia antigua ("se conservan las reglas", "Reiniciar secuencia") ya no es cierta.
    expect(dialog).not.toHaveTextContent(
      /conserva(s|n)? (tus |las )?reglas (desbloqueadas|de la secuencia)/i,
    );
    expect(dialog).not.toHaveTextContent(/reglas se conservan/i);
    expect(within(dialog).queryByRole('button', { name: /Reiniciar/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Nueva secuencia' })).toHaveFocus();
  });

  it('si el fallo es en el primer reto, dice que no había reglas activas que descartar', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () =>
        ok(failed({ discardedRules: [], progress: progress({ totalPoints: 0 }) })),
    });
    renderApp('/juego/arithmetic');

    await play('22');

    const dialog = await dialogOf();
    expect(dialog).toHaveTextContent('Esta secuencia aún no tenía reglas activas.');
    expect(within(dialog).getByLabelText('Qué conservas')).toHaveTextContent(
      /Tus reglas dominadas:\s*0 de 6/,
    );
  });

  it('la racha vuelve a 0, los puntos se mantienen y la nueva secuencia trae otras reglas', async () => {
    const api = game({
      'POST /sessions/s1/attempts': sequence(
        created(attempt()),
        created(
          attempt({
            attemptId: 'a2',
            position: 2,
            expression: '3 * 7 * 2',
            rules: [rule7x1],
            newRule: rule7x1,
          }),
        ),
        created(
          attempt({
            attemptId: 'a3',
            sequenceId: 'q2',
            position: 1,
            challengeCount: 3,
            difficulty: 'EASIER',
            rules: [],
            newRule: null,
          }),
        ),
      ),
      'POST /attempts/a1/answer': () =>
        ok(answer({ progress: progress({ totalPoints: 450, streak: 3, bestStreak: 3 }) })),
      'POST /attempts/a2/answer': () =>
        ok(
          failed({
            attemptId: 'a2',
            failureReason: 'RULE_VIOLATION',
            violations: [violation2],
            message: violation2.message,
            discardedRules: [rule7x1],
          }),
        ),
      'GET /worlds/arithmetic/progress': sequence(
        ok(progress()),
        ok(progress({ totalPoints: 450, streak: 0, bestStreak: 3, unlockedRules: [unlocked(rule2)] })),
      ),
    });
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 3');
    await waitFor(() => expect(scoreboard()).toHaveTextContent(/RACHA\s*3/));
    await finishJump();
    expect(await screen.findByLabelText('Progreso 2 de 4')).toBeInTheDocument();

    await play('21 * 2');
    const dialog = await dialogOf();
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*450/);
    expect(scoreboard()).toHaveTextContent(/RACHA\s*0/);
    expect(within(dialog).getByRole('list', { name: 'Reglas descartadas' })).toHaveTextContent(
      rule7x1.description,
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Nueva secuencia' }));

    // La nueva secuencia es más corta y suave (lo decide el servidor) y no arrastra la regla descartada.
    expect(await screen.findByLabelText('Progreso 1 de 3')).toBeInTheDocument();
    expect(screen.getByText('Suave')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*450/);
    expect(scoreboard()).toHaveTextContent(/RACHA\s*0/);
    expect(within(activeRules()).queryByText(rule7x1.description)).not.toBeInTheDocument();
    // Solo pide al servidor sesión, reto y progreso: no hay ninguna llamada que borre nada.
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(2);
    expect(api.calls.filter((call) => !call.key.startsWith('GET') && !call.key.startsWith('POST'))).toEqual(
      [],
    );
  });

  it('si no se puede empezar otra secuencia, avisa en el diálogo sin perder la explicación del fallo', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () => ok(failed()),
    });
    renderApp('/juego/arithmetic');
    await play('22');
    const dialog = await dialogOf();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nueva secuencia' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor');
    expect(dialog).toHaveTextContent('Tu expresión vale 22');
    expect(within(dialog).getByRole('button', { name: 'Nueva secuencia' })).toBeEnabled();
  });

  it('sin `discardedRules` en la respuesta, muestra como descartadas las reglas del reto fallido', async () => {
    const legacy = failed() as Partial<AnswerResult>;
    delete legacy.discardedRules;
    game({
      'POST /sessions/s1/attempts': () =>
        created(attempt({ position: 3, rules: [rule2, rule7x1], newRule: rule7x1 })),
      'POST /attempts/a1/answer': () => ok(legacy),
    });
    renderApp('/juego/arithmetic');
    await play('22');

    const discarded = within(within(await dialogOf()).getByRole('list', { name: 'Reglas descartadas' }));
    expect(discarded.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('tiempo agotado confirmado por el servidor', () => {
  const closedByServer = {
    'POST /sessions/s1/attempts': () => created(attempt({ remainingMs: 200 })),
    'GET /sessions/s1/attempts/current': () => ({
      status: 404,
      body: { message: 'No hay un reto en curso.' },
    }),
    'GET /worlds/arithmetic/attempts?limit=1': () => ok(timeoutHistory()),
  };

  it('refresca puntos, racha y reglas con el progreso del servidor en vez de dejar valores viejos', async () => {
    const api = game({
      ...closedByServer,
      'GET /worlds/arithmetic/progress': sequence(
        ok(progress({ totalPoints: 300, streak: 3, bestStreak: 3, unlockedRules: [unlocked(rule2)] })),
        ok(progress({ totalPoints: 300, streak: 0, bestStreak: 3, unlockedRules: [unlocked(rule2)] })),
      ),
    });
    renderApp('/juego/arithmetic');

    const dialog = await screen.findByRole('dialog', {}, { timeout: 4000 });
    expect(within(dialog).getByRole('heading', { name: '¡Tiempo agotado!' })).toBeInTheDocument();
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*300/);
    expect(scoreboard()).toHaveTextContent(/RACHA\s*0/);
    expect(dialog).toHaveTextContent(/Tus puntos:\s*300/);
    expect(dialog).toHaveTextContent(/Tu racha vuelve a empezar:\s*0/);
    expect(dialog).toHaveTextContent(/Tus reglas dominadas:\s*1 de 6/);
    expect(api.count('GET /worlds/arithmetic/progress')).toBe(2);
    // La liquidación es del servidor: el cliente no envía ninguna respuesta por su cuenta.
    expect(api.count('POST /attempts/a1/answer')).toBe(0);
  });

  it('descarta las reglas del reto que venció y avisa de que la regla nueva aún no está dominada', async () => {
    game({
      ...closedByServer,
      'POST /sessions/s1/attempts': () =>
        created(attempt({ remainingMs: 200, rules: [rule2], newRule: rule2 })),
    });
    renderApp('/juego/arithmetic');

    const dialog = await screen.findByRole('dialog', {}, { timeout: 4000 });
    expect(within(dialog).getByRole('list', { name: 'Reglas descartadas' })).toHaveTextContent(
      rule2.description,
    );
    expect(dialog).toHaveTextContent('Aún no dominas la regla nueva de este desafío');
  });

  it('no duplica peticiones mientras el servidor aún responde, aunque el reloj siga corriendo', async () => {
    const api = game(closedByServer);
    const base = api.fetchMock.getMockImplementation()!;
    let currentRequests = 0;
    let release: () => void = () => {};
    api.fetchMock.mockImplementation((url, init) => {
      if (!url.endsWith('/attempts/current')) return base(url, init);
      currentRequests += 1;
      return new Promise<Response>((resolve) => {
        release = () => resolve(base(url, init));
      });
    });
    renderApp('/juego/arithmetic');

    await waitFor(() => expect(currentRequests).toBe(1), { timeout: 4000 });
    // Varios ciclos del reloj con la petición pendiente: no debe lanzarse otra.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(currentRequests).toBe(1);
    expect(answerBox()).toBeDisabled();

    release();
    await dialogOf();
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(currentRequests).toBe(1);
    expect(api.count('GET /worlds/arithmetic/attempts?limit=1')).toBe(1);
    expect(api.count('GET /worlds/arithmetic/progress')).toBe(2);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('ante un error de red reintenta más tarde y acaba mostrando el resultado del servidor', async () => {
    const api = game({
      ...closedByServer,
      'GET /worlds/arithmetic/attempts?limit=1': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(timeoutHistory()),
      ),
    });
    renderApp('/juego/arithmetic');

    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      'Error interno del servidor.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    expect(within(dialog).getByRole('heading', { name: '¡Tiempo agotado!' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.count('GET /worlds/arithmetic/attempts?limit=1')).toBe(2);
  }, 10_000);

  it('si el servidor devuelve datos inesperados no inventa un resultado', async () => {
    game({
      ...closedByServer,
      'GET /worlds/arithmetic/progress': sequence(ok(progress({ totalPoints: 300 })), ok({})),
    });
    renderApp('/juego/arithmetic');

    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      'respuesta inesperada del servidor',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*300/);
  });

  it('si el reto se cerró de otra forma (p. ej. respondido en otra pestaña) no lo muestra como timeout', async () => {
    const api = game({
      ...closedByServer,
      'POST /sessions/s1/attempts': sequence(
        created(attempt({ remainingMs: 200 })),
        created(attempt({ attemptId: 'a2', position: 2, rules: [rule2], newRule: rule2 })),
      ),
      'GET /worlds/arithmetic/attempts?limit=1': () =>
        ok({ items: [historyItem({ attemptId: 'a1', outcome: 'CORRECT' })], nextCursor: null }),
    });
    renderApp('/juego/arithmetic');

    expect(await screen.findByLabelText('Progreso 2 de 4', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.count('POST /worlds/arithmetic/sessions')).toBe(2);
  });

  it('si el servidor trabaja con otro reto distinto del mostrado, se resincroniza', async () => {
    game({
      ...closedByServer,
      'POST /sessions/s1/attempts': sequence(
        created(attempt({ remainingMs: 200 })),
        created(attempt({ attemptId: 'a9', position: 3, rules: [rule2, rule7x1], newRule: rule7x1 })),
      ),
      'GET /sessions/s1/attempts/current': () => ok(attempt({ attemptId: 'a9', position: 3 })),
    });
    renderApp('/juego/arithmetic');

    expect(await screen.findByLabelText('Progreso 3 de 4', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un envío fuera de plazo usa el mensaje y el progreso de la respuesta del servidor', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () =>
        ok(
          failed({
            outcome: 'TIMEOUT',
            failureReason: 'TIMEOUT',
            message: 'Se acabó el tiempo.',
            evaluatedValue: null,
          }),
        ),
    });
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 3');

    const dialog = await dialogOf();
    expect(within(dialog).getByRole('heading', { name: '¡Tiempo agotado!' })).toBeInTheDocument();
    expect(within(dialog).getByText('Se acabó el tiempo.')).toBeInTheDocument();
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*450/);
    expect(scoreboard()).toHaveTextContent(/RACHA\s*0/);
  });
});

describe('feedback de un acierto', () => {
  it('muestra puntos, multiplicador, racha y mensaje tal como los devuelve el servidor', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () =>
        ok(
          // Valores deliberadamente "no derivables" (170 ≠ 100 × 1.5): la pantalla debe mostrar lo que dice el servidor.
          answer({
            message: '¡Bien hecho!',
            score: { basePoints: 100, multiplierMilli: 1500, multiplier: '1.5', points: 170 },
            progress: progress({ totalPoints: 270, streak: 2, nextMultiplier: '2' }),
          }),
        ),
    });
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 3');

    const note = await screen.findByRole('status', { name: 'Resultado del intento' });
    expect(note).toHaveTextContent('¡Bien hecho!');
    expect(note).toHaveTextContent(/Puntos ganados\s*\+170/);
    expect(note).toHaveTextContent(/Multiplicador\s*×1\.5/);
    expect(note).toHaveTextContent(/Racha\s*2/);
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*270/);
    expect(note).not.toHaveTextContent('Regla superada');
  });

  it('anuncia la regla superada y que pasa a las reglas dominadas', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt({ position: 2, rules: [rule2], newRule: rule2 })),
      'POST /attempts/a1/answer': () =>
        ok(
          answer({
            unlockedRule: rule2,
            progress: progress({ totalPoints: 100, streak: 1, unlockedRules: [unlocked(rule2)] }),
          }),
        ),
    });
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 6');

    const note = await screen.findByRole('status', { name: 'Resultado del intento' });
    expect(note).toHaveTextContent(`Regla superada: ${rule2.description}`);
    expect(note).toHaveTextContent('Ya forma parte de tus reglas dominadas.');
    expect(note).not.toHaveTextContent(/activa en todas tus secuencias/);
  });

  it('al completar el mundo lo dice, y el aviso desaparece al cargar el siguiente reto', async () => {
    game({
      'POST /sessions/s1/attempts': sequence(
        created(attempt()),
        created(attempt({ attemptId: 'a2', position: 2 })),
      ),
      'POST /attempts/a1/answer': () => ok(answer({ worldCompleted: false })),
    });
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 3');
    expect(await screen.findByRole('status', { name: 'Resultado del intento' })).toBeInTheDocument();
    await finishJump();

    expect(await screen.findByLabelText('Progreso 2 de 4')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Resultado del intento' })).not.toBeInTheDocument();
  });

  it('una respuesta sin el formato esperado no se toma por un acierto y el reto sigue abierto', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt()),
      'POST /attempts/a1/answer': () => ok({ attemptId: 'a1', outcome: 'CORRECT' }),
    });
    renderApp('/juego/arithmetic');

    await play('7 * 1 * 3');

    expect(await screen.findByRole('alert')).toHaveTextContent('respuesta inesperada del servidor');
    expect(screen.queryByRole('status', { name: 'Resultado del intento' })).not.toBeInTheDocument();
    expect(scoreboard()).toHaveTextContent(/PUNTOS\s*0/);
    expect(answerBox()).toBeEnabled();
  });
});

describe('motivos de fallo', () => {
  const cases: {
    name: string;
    over: Partial<AnswerResult>;
    title: string;
    shows: (string | RegExp)[];
    hides?: (string | RegExp)[];
  }[] = [
    {
      name: 'resultado incorrecto (no revela el esperado)',
      over: {},
      title: '¡Secuencia terminada!',
      shows: ['Tu expresión vale 22, pero no da el mismo resultado que el desafío.'],
      hides: [/esperado/, /vale 21/],
    },
    {
      name: 'regla incumplida',
      over: {
        failureReason: 'RULE_VIOLATION',
        message: violation2.message,
        evaluatedValue: '21',
        violations: [violation2],
      },
      title: '¡Secuencia terminada!',
      shows: [
        'El resultado es correcto, pero tu expresión no cumple todas las reglas activas.',
        violation2.message,
      ],
    },
    {
      name: 'expresión inválida',
      over: {
        failureReason: 'SYNTAX_ERROR',
        message: 'Falta cerrar el paréntesis abierto en la posición 1.',
        evaluatedValue: null,
      },
      title: '¡Secuencia terminada!',
      shows: ['Tu expresión no es válida. Falta cerrar el paréntesis abierto en la posición 1.'],
    },
    {
      name: 'división entre cero',
      over: {
        failureReason: 'DIVISION_BY_ZERO',
        message: 'No se puede dividir entre cero.',
        evaluatedValue: null,
      },
      title: '¡Secuencia terminada!',
      shows: ['Tu expresión no es válida. No se puede dividir entre cero.'],
    },
    {
      name: 'resultado escrito que no coincide',
      over: {
        failureReason: 'CLAIMED_RESULT_MISMATCH',
        message: 'Escribiste "= 5", pero tu expresión vale 21.',
      },
      title: '¡Secuencia terminada!',
      shows: ['Escribiste "= 5", pero tu expresión vale 21.'],
    },
    {
      name: 'tiempo agotado',
      over: {
        outcome: 'TIMEOUT',
        failureReason: 'TIMEOUT',
        message: 'Se acabó el tiempo.',
        evaluatedValue: null,
      },
      title: '¡Tiempo agotado!',
      shows: ['Se acabó el tiempo.'],
    },
    {
      name: 'otro motivo informado por el servidor',
      over: { failureReason: 'MOTIVO_NUEVO', message: 'Algo no salió bien con tu respuesta.' },
      title: '¡Secuencia terminada!',
      shows: ['Algo no salió bien con tu respuesta.'],
    },
    {
      name: 'fallo sin mensaje del servidor',
      over: { failureReason: null, message: '' },
      title: '¡Secuencia terminada!',
      shows: ['No pudimos aceptar tu respuesta.'],
    },
  ];

  it.each(cases)('$name', async ({ over, title, shows, hides = [] }) => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt({ rules: [rule2], newRule: rule2 })),
      'POST /attempts/a1/answer': () => ok(failed(over)),
    });
    renderApp('/juego/arithmetic');

    await play('22');

    const dialog = await dialogOf();
    expect(within(dialog).getByRole('heading', { name: title })).toBeInTheDocument();
    for (const text of shows) expect(dialog).toHaveTextContent(text);
    for (const text of hides) expect(dialog).not.toHaveTextContent(text);
    // Nunca se muestran referencias internas ni reglas aún no descubiertas.
    expect(dialog).not.toHaveTextContent(/referenceSolution|expectedResult|dígito 5/);
  });
});

describe('ciclo de vida de las reglas', () => {
  it('la regla nueva del reto se marca como tal y se explica que un fallo descarta las de la secuencia', async () => {
    game({
      'POST /sessions/s1/attempts': () =>
        created(attempt({ position: 3, rules: [rule2, rule7x1], newRule: rule7x1 })),
      'GET /worlds/arithmetic/progress': () => ok(progress({ unlockedRules: [unlocked(rule2)] })),
    });
    renderApp('/juego/arithmetic');

    await screen.findByRole('heading', { name: 'Operación 3 × 7' });
    const [first, second] = within(activeRules()).getAllByRole('listitem');
    expect(within(second).getByText('Nueva')).toBeInTheDocument();
    expect(within(first).queryByText('Nueva')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'La regla nueva se suma a las de esta secuencia. Si fallas, la secuencia termina y sus reglas se descartan.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Supera este desafío para sumarla a tus reglas dominadas.')).toBeInTheDocument();
    expect(screen.queryByText(/siguen activas en todas tus secuencias/)).not.toBeInTheDocument();
  });

  it('una regla nueva que ya dominabas se anuncia igual, con otro texto', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt({ position: 2, rules: [rule2], newRule: rule2 })),
      'GET /worlds/arithmetic/progress': () => ok(progress({ unlockedRules: [unlocked(rule2)] })),
    });
    renderApp('/juego/arithmetic');

    await screen.findByRole('heading', { name: 'Operación 3 × 7' });
    expect(screen.getByText('NUEVA REGLA')).toBeInTheDocument();
    expect(screen.getByText('Ya la dominaste antes: ¡demuéstralo otra vez!')).toBeInTheDocument();
  });

  it('sin regla nueva en el reto, explica que las reglas son las de esta secuencia', async () => {
    game({ 'POST /sessions/s1/attempts': () => created(attempt({ position: 2, rules: [rule2] })) });
    renderApp('/juego/arithmetic');

    await screen.findByRole('heading', { name: 'Operación 3 × 7' });
    expect(
      screen.getByText(
        'Son las reglas de esta secuencia. Si fallas, se descartan y la próxima secuencia sorteará otras.',
      ),
    ).toBeInTheDocument();
  });

  it('sin reglas activas no hay explicación que mostrar', async () => {
    game({ 'POST /sessions/s1/attempts': () => created(attempt()) });
    renderApp('/juego/arithmetic');

    await screen.findByRole('heading', { name: 'Operación 3 × 7' });
    expect(screen.queryByText(/esta secuencia/)).not.toBeInTheDocument();
  });

  it('si falla el reto y su regla nueva no estaba dominada, se indica', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt({ position: 2, rules: [rule2], newRule: rule2 })),
      'POST /attempts/a1/answer': () =>
        ok(failed({ progress: progress({ totalPoints: 450, unlockedRules: [] }) })),
    });
    renderApp('/juego/arithmetic');
    await play('22');

    expect(await dialogOf()).toHaveTextContent(
      'Aún no dominas la regla nueva de este desafío: podrás superarla cuando vuelva a salir en una secuencia.',
    );
  });

  it('si falla un reto cuya regla ya dominaba, no se dice que no la domine', async () => {
    game({
      'POST /sessions/s1/attempts': () => created(attempt({ position: 2, rules: [rule2], newRule: rule2 })),
      'GET /worlds/arithmetic/progress': () => ok(progress({ unlockedRules: [unlocked(rule2)] })),
      'POST /attempts/a1/answer': () => ok(failed()),
    });
    renderApp('/juego/arithmetic');
    await play('22');

    const dialog = await dialogOf();
    expect(dialog).not.toHaveTextContent('Aún no dominas');
    expect(dialog).toHaveTextContent(rule2.description);
  });

  it('secuencias más largas que la ruta por defecto: el grillo avanza por tantas islas como retos', async () => {
    game({
      'POST /sessions/s1/attempts': sequence(
        created(attempt({ position: 5, challengeCount: 6 })),
        created(attempt({ attemptId: 'a2', position: 6, challengeCount: 6 })),
      ),
      'POST /attempts/a1/answer': () => ok(answer()),
    });
    renderApp('/juego/arithmetic');

    expect(await screen.findByLabelText('Progreso 5 de 6')).toBeInTheDocument();
    await play('7 * 1 * 3');
    await finishJump();
    expect(await screen.findByLabelText('Progreso 6 de 6')).toBeInTheDocument();
  });
});
