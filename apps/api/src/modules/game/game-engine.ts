import { ChallengeEngine } from '../challenges';
import { PlayableSequence, ProgressionManager, WorldProgressState } from '../progression';
import { ScoringEngine } from '../scoring';
import { WorldDefinition } from '../worlds';
import { ActiveChallenge, AttemptResult } from './game.types';
import { TimerManager } from './timer-manager';

/** Mensaje de un reto cerrado por tiempo (también identifica los cerrados por el servidor sin envío). */
export const TIMEOUT_MESSAGE = 'Se acabó el tiempo.';

export class GameStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameStateError';
  }
}

export interface GameEngineDependencies {
  challengeEngine: ChallengeEngine;
  timerManager: TimerManager;
  scoringEngine: ScoringEngine;
  progressionManager: ProgressionManager;
}

export interface SubmitAnswerInput {
  state: WorldProgressState;
  /** Mundo: aporta la sintaxis admitida en las respuestas. */
  world: WorldDefinition;
  /** Secuencia en curso (retos generados). */
  sequence: PlayableSequence;
  activeChallenge: ActiveChallenge;
  submission: string;
  /** Instante de recepción medido por el SERVIDOR. */
  submittedAt: Date;
}

/**
 * Fachada que compone los componentes puros del motor para resolver un intento completo:
 * plazo → evaluación (matemática + reglas) → puntuación → progresión.
 * Sin HTTP ni base de datos: la capa de aplicación carga el estado, llama aquí y persiste el resultado.
 */
export class GameEngine {
  constructor(private readonly deps: GameEngineDependencies) {}

  /**
   * Presenta el reto actual de la secuencia y fija el plazo según las reglas activas (superadas + la del reto)
   * y el tiempo extra del mundo. No modifica el progreso: la regla nueva solo se acumula si el jugador acierta.
   */
  startChallenge(
    state: WorldProgressState,
    world: WorldDefinition,
    sequence: PlayableSequence,
    now: Date,
  ): ActiveChallenge {
    const { progressionManager, timerManager } = this.deps;
    const { challenge, activeRules } = progressionManager.presentChallenge(state, sequence);
    const extra = world.sequence.extraTimeSeconds;

    return {
      challenge,
      activeRules,
      startedAt: now,
      deadlineAt: timerManager.calculateDeadline(now, activeRules.length, extra),
      timeLimitSeconds: timerManager.calculateTimeLimitSeconds(activeRules.length, extra),
      streakBefore: state.streak,
    };
  }

  /** Resuelve el único intento del reto. Si llega fuera de plazo es un timeout (no se evalúa). */
  submitAnswer(input: SubmitAnswerInput): AttemptResult {
    const { state, world, sequence, activeChallenge, submission, submittedAt } = input;
    this.assertCurrent(state, activeChallenge);
    const { challengeEngine, timerManager, scoringEngine, progressionManager } = this.deps;

    const timing = timerManager.checkSubmission(
      activeChallenge.startedAt,
      activeChallenge.deadlineAt,
      submittedAt,
    );
    if (!timing.withinTime) {
      return this.fail(input.state, 'TIMEOUT', TIMEOUT_MESSAGE, null, timing.elapsedMs);
    }

    const evaluation = challengeEngine.evaluateSubmission({
      challenge: activeChallenge.challenge,
      activeRules: activeChallenge.activeRules,
      submission,
      syntax: world.syntax,
    });

    if (!evaluation.isCorrect) {
      return this.fail(
        state,
        'INCORRECT',
        evaluation.message,
        evaluation,
        timing.elapsedMs,
        evaluation.failureReason,
      );
    }

    const award = scoringEngine.scoreCorrect(state.streak);
    const nextState = progressionManager.recordCorrect(state, award, sequence);
    const unlockedRuleId =
      nextState.unlockedRuleIds.find((id) => !state.unlockedRuleIds.includes(id)) ?? null;
    return {
      outcome: 'CORRECT',
      failureReason: null,
      message: evaluation.message,
      evaluation,
      award,
      elapsedMs: timing.elapsedMs,
      state: nextState,
      unlockedRuleId,
      sequenceRestarted: false,
      worldCompleted: nextState.status === 'COMPLETED',
    };
  }

  /**
   * Cierra como timeout un reto cuyo plazo venció sin que llegara respuesta (p. ej. el jugador
   * abandonó la pestaña). La capa de aplicación lo invoca al detectar el plazo vencido.
   * @throws GameStateError si el plazo aún no ha vencido.
   */
  expireChallenge(state: WorldProgressState, activeChallenge: ActiveChallenge, now: Date): AttemptResult {
    this.assertCurrent(state, activeChallenge);
    if (!this.deps.timerManager.isExpired(activeChallenge.deadlineAt, now)) {
      throw new GameStateError('El plazo del reto todavía no ha vencido.');
    }
    const elapsedMs = now.getTime() - activeChallenge.startedAt.getTime();
    return this.fail(state, 'TIMEOUT', TIMEOUT_MESSAGE, null, elapsedMs);
  }

  private fail(
    state: WorldProgressState,
    kind: 'INCORRECT' | 'TIMEOUT',
    message: string,
    evaluation: AttemptResult['evaluation'],
    elapsedMs: number,
    evaluationReason: AttemptResult['failureReason'] = null,
  ): AttemptResult {
    const { scoringEngine, progressionManager } = this.deps;
    return {
      outcome: kind,
      failureReason: kind === 'TIMEOUT' ? 'TIMEOUT' : evaluationReason,
      message,
      evaluation,
      award: scoringEngine.scoreFailure(),
      elapsedMs,
      unlockedRuleId: null,
      state: progressionManager.recordFailure(state),
      sequenceRestarted: true,
      worldCompleted: false,
    };
  }

  private assertCurrent(state: WorldProgressState, activeChallenge: ActiveChallenge): void {
    if (state.status === 'COMPLETED' || state.currentPosition !== activeChallenge.challenge.position) {
      throw new GameStateError(
        `El reto "${activeChallenge.challenge.id}" ya no es el reto actual del jugador (posición ${state.currentPosition}).`,
      );
    }
  }
}
