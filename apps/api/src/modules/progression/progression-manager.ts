import { ChallengeDefinition, RuleAccumulator, RuleDefinition } from '../challenges';
import { ScoreAward } from '../scoring';
import { PlayableSequence, PresentedChallenge, WorldProgressState } from './progression.types';

export class ProgressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgressionError';
  }
}

/**
 * Transiciones del progreso de un jugador en un mundo. Lógica pura, sin I/O.
 *
 * Una SECUENCIA es un subconjunto aleatorio de reglas del mundo en orden aleatorio (lo decide el planificador al
 * empezarla). Dentro de la secuencia las reglas se acumulan; fuera de ella no existen:
 *  - `recordFailure` (fallo o tiempo agotado): vuelve al reto 1, racha a 0 y DESCARTA las reglas de la secuencia
 *    (la siguiente sorteará otras). Los puntos se conservan.
 *  - `recordCorrect` en el último reto: completa el mundo (`completionsCount + 1`).
 *  - `startNewRun`: tras completar, vuelve al reto 1 de una secuencia nueva conservando puntos y racha.
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
      completionsCount: 0,
    };
  }

  /** Reglas ya superadas en la secuencia, en orden de introducción. */
  getActiveRules(state: WorldProgressState, sequence: PlayableSequence): readonly RuleDefinition[] {
    const byId = new Map(sequence.rules.map((rule) => [rule.id, rule]));
    const accumulator = state.unlockedRuleIds.reduce((acc, ruleId) => {
      const rule = byId.get(ruleId);
      if (!rule)
        throw new ProgressionError(
          `La regla "${ruleId}" de la secuencia no existe en el mundo "${sequence.worldSlug}".`,
        );
      return acc.unlock(rule);
    }, RuleAccumulator.empty());
    return accumulator.rules;
  }

  getCurrentChallenge(state: WorldProgressState, sequence: PlayableSequence): ChallengeDefinition {
    if (state.status === 'COMPLETED') {
      throw new ProgressionError(
        `El mundo "${sequence.worldSlug}" ya está completado; empieza una secuencia nueva para volver a jugar.`,
      );
    }
    const challenge = sequence.challenges[state.currentPosition - 1];
    if (!challenge) {
      throw new ProgressionError(
        `No existe el reto en la posición ${state.currentPosition} de la secuencia del mundo "${sequence.worldSlug}".`,
      );
    }
    return challenge;
  }

  /**
   * Reglas activas en el reto actual: las ya superadas en la secuencia más la que introduce el reto.
   * No modifica el estado: la regla nueva solo se acumula al completar el reto (`recordCorrect`).
   */
  presentChallenge(state: WorldProgressState, sequence: PlayableSequence): PresentedChallenge {
    const challenge = this.getCurrentChallenge(state, sequence);
    const unlocked = this.getActiveRules(state, sequence);
    const introduced = challenge.introducesRuleId
      ? sequence.rules.find((rule) => rule.id === challenge.introducesRuleId)
      : undefined;
    if (challenge.introducesRuleId && !introduced) {
      throw new ProgressionError(
        `El reto ${challenge.position} introduce la regla desconocida "${challenge.introducesRuleId}".`,
      );
    }
    const activeRules =
      introduced && !unlocked.some((rule) => rule.id === introduced.id)
        ? [...unlocked, introduced]
        : unlocked;
    return { challenge, activeRules };
  }

  /** Acierto: acumula la regla del reto, avanza, suma puntos y actualiza la racha. */
  recordCorrect(
    state: WorldProgressState,
    award: ScoreAward,
    sequence: PlayableSequence,
  ): WorldProgressState {
    const challenge = this.getCurrentChallenge(state, sequence);
    const ruleId = challenge.introducesRuleId;
    const nextPosition = state.currentPosition + 1;
    const completed = nextPosition > sequence.challenges.length;
    return {
      ...state,
      unlockedRuleIds:
        ruleId !== null && !state.unlockedRuleIds.includes(ruleId)
          ? [...state.unlockedRuleIds, ruleId]
          : state.unlockedRuleIds,
      currentPosition: nextPosition,
      streak: award.streakAfter,
      bestStreak: Math.max(state.bestStreak, award.streakAfter),
      totalPoints: state.totalPoints + award.points,
      status: completed ? 'COMPLETED' : 'IN_PROGRESS',
      completionsCount: completed ? state.completionsCount + 1 : state.completionsCount,
    };
  }

  /** Fallo o timeout: vuelve al reto 1, racha a 0 y descarta las reglas de la secuencia. Conserva los puntos. */
  recordFailure(state: WorldProgressState): WorldProgressState {
    return { ...state, currentPosition: 1, streak: 0, unlockedRuleIds: [], status: 'IN_PROGRESS' };
  }

  /**
   * Nueva partida tras completar el mundo: reto 1 de una secuencia nueva conservando puntos y racha
   * (completar no es fallar, así que la racha no se reinicia).
   */
  startNewRun(state: WorldProgressState): WorldProgressState {
    return { ...state, currentPosition: 1, unlockedRuleIds: [], status: 'IN_PROGRESS' };
  }

  /** Reinicia el MUNDO (acción administrativa): posición y reglas a cero. Conserva puntos, mejor racha y compleciones. */
  resetWorldProgress(state: WorldProgressState): WorldProgressState {
    return {
      ...this.createInitialState(state.worldSlug),
      totalPoints: state.totalPoints,
      bestStreak: state.bestStreak,
      completionsCount: state.completionsCount,
    };
  }
}
