import { arithmeticWorld } from '../worlds';
import { ProgressionError, ProgressionManager } from './progression-manager';

const manager = new ProgressionManager();
const award = (streakAfter: number, points: number) => ({
  basePoints: 100,
  multiplierMilli: 1000,
  points,
  streakAfter,
});

describe('ProgressionManager', () => {
  const initial = manager.createInitialState('arithmetic');

  it('estado inicial: reto 1, racha 0, sin reglas ni puntos', () => {
    expect(initial).toMatchObject({
      currentPosition: 1,
      streak: 0,
      totalPoints: 0,
      unlockedRuleIds: [],
      status: 'IN_PROGRESS',
    });
  });

  it('presentar un reto desbloquea la regla que introduce, una sola vez', () => {
    const first = manager.beginChallenge(initial, arithmeticWorld);
    expect(first.challenge.id).toBe('arithmetic-001');
    expect(first.state.unlockedRuleIds).toEqual([]); // el reto 1 no introduce reglas

    const atTwo = { ...first.state, currentPosition: 2 };
    const second = manager.beginChallenge(atTwo, arithmeticWorld);
    expect(second.state.unlockedRuleIds).toEqual(['arithmetic.forbidden-digit-2']);
    expect(manager.beginChallenge(second.state, arithmeticWorld).state.unlockedRuleIds).toEqual(
      second.state.unlockedRuleIds,
    );
  });

  it('las reglas activas se devuelven como definiciones, en orden de desbloqueo', () => {
    const state = {
      ...initial,
      unlockedRuleIds: ['arithmetic.required-7-times-1', 'arithmetic.forbidden-digit-2'],
    };
    expect(manager.getActiveRules(state, arithmeticWorld).map((r) => r.id)).toEqual(state.unlockedRuleIds);
    expect(() => manager.getActiveRules({ ...initial, unlockedRuleIds: ['nope'] }, arithmeticWorld)).toThrow(
      ProgressionError,
    );
  });

  it('un acierto avanza, suma puntos y actualiza racha y mejor racha', () => {
    const next = manager.recordCorrect(initial, award(1, 100), arithmeticWorld);
    expect(next).toMatchObject({
      currentPosition: 2,
      streak: 1,
      bestStreak: 1,
      totalPoints: 100,
      status: 'IN_PROGRESS',
    });
  });

  it('completar el último reto marca el mundo como completado', () => {
    const last = { ...initial, currentPosition: arithmeticWorld.challenges.length };
    const done = manager.recordCorrect(last, award(4, 100), arithmeticWorld);
    expect(done.status).toBe('COMPLETED');
    expect(() => manager.beginChallenge(done, arithmeticWorld)).toThrow(ProgressionError);
  });

  describe('reiniciar la SECUENCIA (fallo) ≠ reiniciar el MUNDO', () => {
    const progressed = {
      ...initial,
      currentPosition: 3,
      streak: 2,
      bestStreak: 2,
      totalPoints: 250,
      unlockedRuleIds: ['arithmetic.forbidden-digit-2', 'arithmetic.required-7-times-1'],
    };

    it('recordFailure: vuelve al reto 1 y racha 0, conserva reglas, puntos y mejor racha', () => {
      expect(manager.recordFailure(progressed)).toEqual({
        ...progressed,
        currentPosition: 1,
        streak: 0,
      });
    });

    it('resetWorldProgress: además borra las reglas acumuladas, pero nunca los puntos', () => {
      expect(manager.resetWorldProgress(progressed)).toEqual({
        worldSlug: 'arithmetic',
        currentPosition: 1,
        streak: 0,
        bestStreak: 2,
        totalPoints: 250,
        unlockedRuleIds: [],
        status: 'IN_PROGRESS',
      });
    });

    it('no muta el estado original', () => {
      const snapshot = JSON.stringify(progressed);
      manager.recordFailure(progressed);
      manager.resetWorldProgress(progressed);
      expect(JSON.stringify(progressed)).toBe(snapshot);
    });
  });
});
