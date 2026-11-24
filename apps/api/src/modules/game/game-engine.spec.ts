import { createChallengeEngine } from '../challenges';
import { ProgressionManager, WorldProgressState } from '../progression';
import { ScoringEngine, StreakManager } from '../scoring';
import { CLASSIC_SEQUENCE, CLASSIC_WORLD } from '../progression/testing/classic-sequence.fixture';
import { GameEngine, GameStateError } from './game-engine';
import { TimerManager } from './timer-manager';

const progression = new ProgressionManager();
const engine = new GameEngine({
  challengeEngine: createChallengeEngine(),
  timerManager: new TimerManager({ baseTimeSeconds: 60, additionalTimePerRuleSeconds: 15 }),
  scoringEngine: new ScoringEngine({ basePoints: 100 }, new StreakManager()),
  progressionManager: progression,
});

const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const world = CLASSIC_WORLD;
const sequence = CLASSIC_SEQUENCE;

/** Presenta el reto actual y envía `submission` a los `seconds` s del inicio. */
function play(state: WorldProgressState, submission: string, seconds = 5) {
  const activeChallenge = engine.startChallenge(state, world, sequence, T0);
  const result = engine.submitAnswer({
    state,
    world,
    sequence,
    activeChallenge,
    submission,
    submittedAt: at(seconds),
  });
  return { started: { activeChallenge }, result };
}

describe('GameEngine — flujo del mundo Aritmética', () => {
  it('reto 1: sin reglas, tiempo base; "21" es correcto y otorga 100 puntos (1x)', () => {
    const { started, result } = play(progression.createInitialState('arithmetic'), '21');
    expect(started.activeChallenge.activeRules).toEqual([]);
    expect(started.activeChallenge.timeLimitSeconds).toBe(60);
    expect(result).toMatchObject({ outcome: 'CORRECT', failureReason: null, elapsedMs: 5000 });
    expect(result.award).toMatchObject({ points: 100, multiplierMilli: 1000, streakAfter: 1 });
    expect(result.state).toMatchObject({ currentPosition: 2, streak: 1, totalPoints: 100 });
  });

  it('racha completa: 1x, 1.5x, 2x, 2.5x y el mundo se completa', () => {
    const answers = ['21', '41 + 1 = 42', '7 * 1 = 7', '7 * 1 * 4 + 3 * 4'];
    let state = progression.createInitialState('arithmetic');
    const points: number[] = [];
    let last;
    for (const answer of answers) {
      const { result } = play(state, answer);
      expect(result.outcome).toBe('CORRECT');
      points.push(result.award.points);
      state = result.state;
      last = result;
    }
    expect(points).toEqual([100, 150, 200, 250]);
    expect(state).toMatchObject({ totalPoints: 700, streak: 4, bestStreak: 4, status: 'COMPLETED' });
    expect(last?.worldCompleted).toBe(true);
  });

  it('el tiempo crece con las reglas activas (60 → 60 → 75 → 90)', () => {
    let state = progression.createInitialState('arithmetic');
    const limits: number[] = [];
    for (const answer of ['21', '41 + 1', '7 * 1', '7 * 1 * 4 + 3 * 4']) {
      const { started, result } = play(state, answer);
      limits.push(started.activeChallenge.timeLimitSeconds);
      state = result.state;
    }
    expect(limits).toEqual([60, 60, 75, 90]);
  });

  it('resultado correcto que viola una regla activa → INCORRECT', () => {
    const afterFirst = play(progression.createInitialState('arithmetic'), '21').result.state;
    const { result } = play(afterFirst, '21 * 2'); // 42 correcto, pero usa el 2 (regla del reto 2)
    expect(result).toMatchObject({ outcome: 'INCORRECT', failureReason: 'RULE_VIOLATION' });
    expect(result.evaluation?.value).toBe('42');
    expect(result.award.points).toBe(0);
  });

  describe('fallo: un solo intento, la secuencia termina y sus reglas se descartan; los puntos persisten', () => {
    // El jugador llega al reto 3 con racha 2 y 250 puntos, y falla ahí.
    let state = progression.createInitialState('arithmetic');
    state = play(state, '21').result.state;
    state = play(state, '41 + 1').result.state;
    const failing = play(state, '3 * 7 * 2 / 6'); // = 7 pero sin 7 * 1 y con 2 prohibido

    it('termina el reto, reinicia racha y secuencia, y no otorga puntos', () => {
      expect(failing.result).toMatchObject({ outcome: 'INCORRECT', sequenceRestarted: true });
      expect(failing.result.award).toEqual({ basePoints: 0, multiplierMilli: 0, points: 0, streakAfter: 0 });
      expect(failing.result.state).toMatchObject({ currentPosition: 1, streak: 0 });
    });

    it('conserva los puntos ya ganados y la mejor racha', () => {
      expect(failing.result.state.totalPoints).toBe(250);
      expect(failing.result.state.bestStreak).toBe(2);
    });

    it('descarta las reglas de la secuencia (también la ya superada); la del reto fallido no se acumula', () => {
      expect(failing.result.state.unlockedRuleIds).toEqual([]);
      expect(failing.result.unlockedRuleId).toBeNull();
    });

    it('la secuencia siguiente empieza en el reto 1 sin reglas y con el tiempo base', () => {
      const replay = engine.startChallenge(failing.result.state, world, sequence, T0);
      expect(replay.challenge.position).toBe(1);
      expect(replay.activeRules).toEqual([]);
      expect(replay.timeLimitSeconds).toBe(60);
      expect(replay.streakBefore).toBe(0);
    });

    it('sin las reglas descartadas, "21" vuelve a ser válido en el reto 1 (racha desde 1x)', () => {
      const again = play(failing.result.state, '21');
      expect(again.result.outcome).toBe('CORRECT');
      expect(again.result.award).toMatchObject({ points: 100, streakAfter: 1 });
    });
  });

  it.each([
    ['sintaxis inválida', '3 *', 'SYNTAX_ERROR'],
    ['división entre cero', '21 + 1 / 0', 'DIVISION_BY_ZERO'],
    ['resultado erróneo', '22', 'WRONG_RESULT'],
    ['resultado declarado erróneo', '3 * 7 = 22', 'CLAIMED_RESULT_MISMATCH'],
  ])('%s → INCORRECT y reinicio', (_name, submission, reason) => {
    const { result } = play(progression.createInitialState('arithmetic'), submission);
    expect(result).toMatchObject({ outcome: 'INCORRECT', failureReason: reason, sequenceRestarted: true });
    expect(result.state.streak).toBe(0);
  });
});

describe('GameEngine — tiempo (autoridad del servidor)', () => {
  const state = progression.createInitialState('arithmetic');

  it('un envío a tiempo se evalúa; en el instante exacto del plazo todavía vale', () => {
    expect(play(state, '21', 60).result.outcome).toBe('CORRECT');
  });

  it('un envío tardío es TIMEOUT aunque la respuesta sea correcta y no se evalúa', () => {
    const { result } = play(state, '21', 60.001);
    expect(result).toMatchObject({
      outcome: 'TIMEOUT',
      failureReason: 'TIMEOUT',
      evaluation: null,
      sequenceRestarted: true,
    });
    expect(result.award.points).toBe(0);
    expect(result.state).toMatchObject({ currentPosition: 1, streak: 0 });
  });

  it('un timeout conserva los puntos pero descarta las reglas de la secuencia', () => {
    const progressed: WorldProgressState = {
      ...state,
      currentPosition: 2,
      streak: 1,
      totalPoints: 100,
      unlockedRuleIds: ['arithmetic.forbidden-digit-2'],
    };
    const { result } = play(progressed, '41 + 1', 61);
    expect(result.outcome).toBe('TIMEOUT');
    expect(result.state).toMatchObject({
      totalPoints: 100,
      unlockedRuleIds: [],
      streak: 0,
      currentPosition: 1,
    });
  });

  it('expireChallenge cierra como timeout un reto sin respuesta una vez vencido el plazo', () => {
    const active = engine.startChallenge(state, world, sequence, T0);
    expect(() => engine.expireChallenge(state, active, at(30))).toThrow(GameStateError);
    const result = engine.expireChallenge(state, active, at(90));
    expect(result).toMatchObject({ outcome: 'TIMEOUT', elapsedMs: 90_000 });
  });

  it('no permite responder un reto que ya no es el actual (p. ej. reenvío tras resolver)', () => {
    const active = engine.startChallenge(state, world, sequence, T0);
    const solved = engine.submitAnswer({
      state,
      world,
      sequence,
      activeChallenge: active,
      submission: '21',
      submittedAt: at(1),
    });
    expect(() =>
      engine.submitAnswer({
        state: solved.state,
        world,
        sequence,
        activeChallenge: active,
        submission: '21',
        submittedAt: at(2),
      }),
    ).toThrow(GameStateError);
  });
});

describe('GameEngine — la regla nueva se acumula solo al completar el reto', () => {
  const afterOne = play(progression.createInitialState('arithmetic'), '21').result.state;

  it('durante el reto 2 la regla del dígito 2 ya aplica y cuenta para el tiempo', () => {
    const active = engine.startChallenge(afterOne, world, sequence, T0);
    expect(active.activeRules.map((r) => r.id)).toEqual(['arithmetic.forbidden-digit-2']);
    expect(afterOne.unlockedRuleIds).toEqual([]); // aún no está guardada
  });

  it('acertar guarda la regla y lo informa en el resultado', () => {
    const { result } = play(afterOne, '41 + 1');
    expect(result.unlockedRuleId).toBe('arithmetic.forbidden-digit-2');
    expect(result.state.unlockedRuleIds).toEqual(['arithmetic.forbidden-digit-2']);
  });

  it('fallar o agotar el tiempo NO guarda la regla del reto', () => {
    expect(play(afterOne, '21 * 2').result.state.unlockedRuleIds).toEqual([]);
    expect(play(afterOne, '41 + 1', 999).result.state.unlockedRuleIds).toEqual([]);
  });

  it('al reintentar el mismo reto, la regla vuelve a presentarse como nueva', () => {
    const failed = play(afterOne, '21 * 2').result.state;
    const second = engine.startChallenge({ ...failed, currentPosition: 2 }, world, sequence, T0);
    expect(second.activeRules.map((r) => r.id)).toEqual(['arithmetic.forbidden-digit-2']);
  });
});

describe('GameEngine — tiempo extra por mundo', () => {
  it('suma `extraTimeSeconds` del mundo al plazo de cada reto', () => {
    const slow = { ...world, sequence: { ...world.sequence, extraTimeSeconds: 20 } };
    const active = engine.startChallenge(progression.createInitialState('arithmetic'), slow, sequence, T0);
    expect(active.timeLimitSeconds).toBe(80);
    expect(active.deadlineAt.getTime() - T0.getTime()).toBe(80_000);
  });
});
