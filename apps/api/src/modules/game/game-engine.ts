import { ChallengeEngine } from '../challenges';
import { ProgressionManager, WorldProgressState } from '../progression';
import { ScoringEngine } from '../scoring';
import { WorldDefinition } from '../worlds';
import { ActiveChallenge, AttemptResult, StartedChallenge } from './game.types';
import { TimerManager } from './timer-manager';

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
  world: WorldDefinition;
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

  /** Presenta el reto actual, desbloquea su regla y fija el plazo según las reglas activas. */
  startChallenge(state: WorldProgressState, world: WorldDefinition, now: Date): StartedChallenge {
    const { progressionManager, timerManager } = this.deps;
    const begun = progressionManager.beginChallenge(state, world);
    const activeRules = progressionManager.getActiveRules(begun.state, world);
    const timeLimitSeconds = timerManager.calculateTimeLimitSeconds(activeRules.length);

    return {
      state: begun.state,
      activeChallenge: {
        challenge: begun.challenge,
        activeRules,
        startedAt: now,
        deadlineAt: timerManager.calculateDeadline(now, activeRules.length),
        timeLimitSeconds,
        streakBefore: begun.state.streak,
      },
    };
  }

  /** Resuelve el único intento del reto. Si llega fuera de plazo es un timeout (no se evalúa). */
  submitAnswer(input: SubmitAnswerInput): AttemptResult {
    const { state, world, activeChallenge, submission, submittedAt } = input;
    this.assertCurrent(state, activeChallenge);
    const { challengeEngine, timerManager, scoringEngine, progressionManager } = this.deps;

    const timing = timerManager.checkSubmission(
      activeChallenge.startedAt,
      activeChallenge.deadlineAt,
      submittedAt,
    );
    if (!timing.withinTime) {
      return this.fail(input.state, 'TIMEOUT', 'Se acabó el tiempo.', null, timing.elapsedMs);
    }

    const evaluation = challengeEngine.evaluateSubmission({
      challenge: activeChallenge.challenge,
      activeRules: activeChallenge.activeRules,
      submission,
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
    const nextState = progressionManager.recordCorrect(state, award, world);
    return {
      outcome: 'CORRECT',
      failureReason: null,
      message: evaluation.message,
      evaluation,
      award,
      elapsedMs: timing.elapsedMs,
      state: nextState,
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
    return this.fail(state, 'TIMEOUT', 'Se acabó el tiempo.', null, elapsedMs);
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
