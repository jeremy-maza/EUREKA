import { ProgressionError, ProgressionManager } from './progression-manager';
import { CLASSIC_RULES, CLASSIC_SEQUENCE } from './testing/classic-sequence.fixture';

const manager = new ProgressionManager();
const sequence = CLASSIC_SEQUENCE;
const [NO_2, SEVEN_ONE] = CLASSIC_RULES.map((rule) => rule.id);
const award = (streakAfter: number, points: number) => ({
  basePoints: 100,
  multiplierMilli: 1000,
  points,
  streakAfter,
});

describe('ProgressionManager (secuencias con reglas propias)', () => {
  const initial = manager.createInitialState('arithmetic');

  it('estado inicial: reto 1, racha 0, sin reglas, puntos ni compleciones', () => {
    expect(initial).toEqual({
      worldSlug: 'arithmetic',
      currentPosition: 1,
      streak: 0,
      bestStreak: 0,
      totalPoints: 0,
      unlockedRuleIds: [],
      status: 'IN_PROGRESS',
      completionsCount: 0,
    });
  });

  it('presentar un reto incluye su regla como activa pero NO la acumula', () => {
    const first = manager.presentChallenge(initial, sequence);
    expect(first.challenge.id).toBe('c1');
    expect(first.activeRules).toEqual([]); // el reto 1 no introduce reglas

    const atTwo = { ...initial, currentPosition: 2 };
    const second = manager.presentChallenge(atTwo, sequence);
    expect(second.activeRules.map((r) => r.id)).toEqual([NO_2]);
    expect(atTwo.unlockedRuleIds).toEqual([]);
  });

  it('las reglas activas son las superadas en la secuencia + la nueva, en orden', () => {
    const state = { ...initial, currentPosition: 3, unlockedRuleIds: [NO_2] };
    expect(manager.presentChallenge(state, sequence).activeRules.map((r) => r.id)).toEqual([NO_2, SEVEN_ONE]);
    expect(() => manager.getActiveRules({ ...initial, unlockedRuleIds: ['nope'] }, sequence)).toThrow(
      ProgressionError,
    );
  });

  it('un reto que introduce una regla desconocida es un defecto (no se presenta)', () => {
    const broken = {
      ...sequence,
      challenges: [sequence.challenges[0], { ...sequence.challenges[1], introducesRuleId: 'nope' }],
    };
    expect(() => manager.presentChallenge({ ...initial, currentPosition: 2 }, broken)).toThrow(
      ProgressionError,
    );
  });

  it('acierto: acumula la regla del reto, avanza, suma puntos y racha', () => {
    const atTwo = { ...initial, currentPosition: 2, streak: 1, bestStreak: 1, totalPoints: 100 };
    const next = manager.recordCorrect(atTwo, award(2, 150), sequence);
    expect(next).toMatchObject({
      currentPosition: 3,
      streak: 2,
      bestStreak: 2,
      totalPoints: 250,
      unlockedRuleIds: [NO_2],
      status: 'IN_PROGRESS',
      completionsCount: 0,
    });
    expect(atTwo.unlockedRuleIds).toEqual([]); // inmutable
  });

  it('acertar el último reto completa el mundo y cuenta una compleción', () => {
    const last = { ...initial, currentPosition: 4, unlockedRuleIds: [NO_2, SEVEN_ONE], completionsCount: 1 };
    const done = manager.recordCorrect(last, award(4, 250), sequence);
    expect(done).toMatchObject({ status: 'COMPLETED', currentPosition: 5, completionsCount: 2 });
    expect(() => manager.presentChallenge(done, sequence)).toThrow(ProgressionError);
  });

  it('fallo: vuelve al reto 1, racha a 0 y DESCARTA las reglas de la secuencia; conserva puntos', () => {
    const progressed = {
      ...initial,
      currentPosition: 3,
      streak: 2,
      bestStreak: 5,
      totalPoints: 250,
      unlockedRuleIds: [NO_2],
      completionsCount: 1,
    };
    expect(manager.recordFailure(progressed)).toEqual({
      ...progressed,
      currentPosition: 1,
      streak: 0,
      unlockedRuleIds: [],
      status: 'IN_PROGRESS',
    });
  });

  it('nueva partida tras completar: reto 1 sin reglas, conserva racha, puntos y compleciones', () => {
    const done = {
      ...initial,
      status: 'COMPLETED' as const,
      currentPosition: 5,
      streak: 4,
      unlockedRuleIds: [NO_2],
    };
    expect(manager.startNewRun(done)).toMatchObject({
      status: 'IN_PROGRESS',
      currentPosition: 1,
      streak: 4,
      unlockedRuleIds: [],
    });
  });

  it('resetWorldProgress: borra posición y reglas, nunca puntos, mejor racha ni compleciones', () => {
    const progressed = {
      ...initial,
      currentPosition: 3,
      streak: 2,
      bestStreak: 7,
      totalPoints: 900,
      unlockedRuleIds: [NO_2],
      completionsCount: 2,
    };
    expect(manager.resetWorldProgress(progressed)).toEqual({
      ...initial,
      bestStreak: 7,
      totalPoints: 900,
      completionsCount: 2,
    });
  });
});
