import { ChallengeDefinition, RuleAccumulator, RuleDefinition } from '../challenges';
import { ScoreAward } from '../scoring';
import { WorldDefinition } from '../worlds';
import { BegunChallenge, WorldProgressState } from './progression.types';

export class ProgressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgressionError';
  }
}

/**
 * Transiciones del progreso de un jugador en un mundo. Lógica pura, sin I/O.
 *
 * Dos operaciones distintas que NO deben confundirse:
 *  - `recordFailure` (reiniciar la SECUENCIA): vuelve al reto 1 y pone la racha a 0,
 *    pero conserva reglas desbloqueadas y puntos.
 *  - `resetWorldProgress` (reiniciar el MUNDO): además borra las reglas acumuladas.
 *    Es una acción administrativa; los puntos ganados jamás se borran.
 */
export class ProgressionManager {
  createInitialState(worldSlug: string): WorldProgressState {
    return {
      worldSlug,
      currentPosition: 1,
      streak: 0,
      bestStreak: 0,
      totalPoints: 0,
      unlockedRuleIds: [],
      status: 'IN_PROGRESS',
    };
  }

  /** Reglas activas del jugador, en orden de desbloqueo. */
  getActiveRules(state: WorldProgressState, world: WorldDefinition): readonly RuleDefinition[] {
    const byId = new Map(world.rules.map((rule) => [rule.id, rule]));
    const accumulator = state.unlockedRuleIds.reduce((acc, ruleId) => {
      const rule = byId.get(ruleId);
      if (!rule)
        throw new ProgressionError(
          `La regla desbloqueada "${ruleId}" no existe en el mundo "${world.slug}".`,
        );
      return acc.unlock(rule);
    }, RuleAccumulator.empty());
    return accumulator.rules;
  }

  getCurrentChallenge(state: WorldProgressState, world: WorldDefinition): ChallengeDefinition {
    if (state.status === 'COMPLETED') {
      throw new ProgressionError(
        `El mundo "${world.slug}" ya está completado; reinicia la secuencia para volver a jugar.`,
      );
    }
    const challenge = world.challenges[state.currentPosition - 1];
    if (!challenge) {
      throw new ProgressionError(
        `No existe el reto en la posición ${state.currentPosition} del mundo "${world.slug}".`,
      );
    }
    return challenge;
  }

  /**
   * Presenta el reto actual y desbloquea (de forma permanente) la regla que introduce.
   * Idempotente: volver a presentar un reto no duplica reglas.
   */
  beginChallenge(state: WorldProgressState, world: WorldDefinition): BegunChallenge {
    const challenge = this.getCurrentChallenge(state, world);
    const ruleId = challenge.introducesRuleId;
    const unlockedRuleIds =
      ruleId !== null && !state.unlockedRuleIds.includes(ruleId)
        ? [...state.unlockedRuleIds, ruleId]
        : state.unlockedRuleIds;
    return { state: { ...state, unlockedRuleIds }, challenge };
  }

  /** Acierto: avanza al siguiente reto, suma puntos y actualiza racha. */
  recordCorrect(state: WorldProgressState, award: ScoreAward, world: WorldDefinition): WorldProgressState {
    const nextPosition = state.currentPosition + 1;
    return {
      ...state,
      currentPosition: nextPosition,
      streak: award.streakAfter,
      bestStreak: Math.max(state.bestStreak, award.streakAfter),
      totalPoints: state.totalPoints + award.points,
      status: nextPosition > world.challenges.length ? 'COMPLETED' : 'IN_PROGRESS',
    };
  }

  /** Fallo o timeout: reinicia la SECUENCIA (reto 1, racha 0). Conserva reglas y puntos. */
  recordFailure(state: WorldProgressState): WorldProgressState {
    return this.restartSequence(state);
  }

  /** Vuelve al primer reto con racha 0 conservando reglas desbloqueadas y puntos. */
  restartSequence(state: WorldProgressState): WorldProgressState {
    return { ...state, currentPosition: 1, streak: 0, status: 'IN_PROGRESS' };
  }

  /** Reinicia el MUNDO: borra reglas acumuladas y posición. Conserva puntos y mejor racha. */
  resetWorldProgress(state: WorldProgressState): WorldProgressState {
    return {
      ...this.createInitialState(state.worldSlug),
      totalPoints: state.totalPoints,
      bestStreak: state.bestStreak,
    };
  }
}
