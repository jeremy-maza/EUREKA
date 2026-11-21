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

  it('presentar un reto incluye su regla como activa pero NO la desbloquea', () => {
    const first = manager.presentChallenge(initial, arithmeticWorld);
    expect(first.challenge.id).toBe('arithmetic-001');
    expect(first.activeRules).toEqual([]); // el reto 1 no introduce reglas

    const atTwo = { ...initial, currentPosition: 2 };
    const second = manager.presentChallenge(atTwo, arithmeticWorld);
    expect(second.activeRules.map((r) => r.id)).toEqual(['arithmetic.forbidden-digit-2']);
    expect(atTwo.unlockedRuleIds).toEqual([]);
  });

  it('no duplica la regla del reto si ya estaba desbloqueada (reintento tras reinicio)', () => {
    const state = { ...initial, currentPosition: 2, unlockedRuleIds: ['arithmetic.forbidden-digit-2'] };
    expect(manager.presentChallenge(state, arithmeticWorld).activeRules).toHaveLength(1);
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
    expect(() => manager.presentChallenge(done, arithmeticWorld)).toThrow(ProgressionError);
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
