import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Clock } from '../../common';
import { ChallengeAttempt, Prisma, SequenceChallenge } from '../../generated/prisma/client';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { ChallengeDefinition } from '../challenges';
import { ProgressionManager, ProgressionService } from '../progression';
import { ScoreService, formatMultiplier } from '../scoring';
import { StatisticsService } from '../statistics';
import { LoadedWorld, WorldsRepository } from '../worlds';
import {
  AnswerResultDto,
  ChallengeAttemptDto,
  DifficultyDto,
  ExpiredAttemptDto,
  SessionDto,
  StartSessionResponseDto,
  ViolationDto,
  WorldRefDto,
} from './dto/game.dto';
import { GameEngine, GameStateError, TIMEOUT_MESSAGE } from './game-engine';
import { ActiveChallenge, AttemptResult } from './game.types';
import { parseViolations, toRuleDto, toSessionDto } from './game.mappers';
import { ProgressViewBuilder } from './progress-view.builder';
import { SequenceStore, StoredSequence } from './sequence-store';
import { WorldUnlockService } from './world-unlocks.service';

type AttemptRow = ChallengeAttempt & { sequenceChallenge: SequenceChallenge | null };

interface Resolution {
  userId: string;
  world: LoadedWorld;
  progressId: string;
  attempt: AttemptRow;
  sequenceId: string;
  result: AttemptResult;
  /** Texto enviado por el jugador (null si el servidor cerró el intento por tiempo). */
  submission: string | null;
  submittedAt: Date | null;
  /** Instante del servidor que decide esta resolución. */
  now: Date;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
const INT_MAX = 2_147_483_647;
const ATTEMPT_INCLUDE = { sequenceChallenge: true } as const;
/** Mensaje de un reto que el servidor retira sin culpa del jugador (catálogo actualizado o reto del catálogo antiguo). */
export const RETIRED_ATTEMPT_MESSAGE =
  'Este reto se retiró por una actualización del juego. Tu racha y tus puntos se conservan; empieza una secuencia nueva.';

/**
 * Capa de aplicación del juego. Orquesta el motor puro (`GameEngine`) con la persistencia.
 *
 * Una partida en un mundo es una sucesión de SECUENCIAS. Cada secuencia sortea (semilla del servidor) un subconjunto
 * de reglas del mundo y su orden, y genera un reto por posición; se guarda entera al empezar (`SequenceStore`).
 * Fallar o agotar el tiempo la cierra como FAILED y descarta sus reglas; completarla completa el mundo.
 *
 * Garantías de integridad:
 *  - El servidor es la única fuente de tiempo (`Clock`), de puntuación, rachas, reglas y retos.
 *  - Cada operación que cambia el estado de un jugador/mundo corre en UNA transacción que antes
 *    BLOQUEA la fila de progreso (`FOR UPDATE`): no hay carreras entre responder, iniciar o expirar.
 *  - La resolución de un intento es de una sola vez: `UPDATE … WHERE outcome = 'PENDING'`,
 *    `ScoreTransaction.attemptId` único y un reenvío idéntico devuelve el resultado original.
 *  - Solo se juega un mundo desbloqueado (`WorldUnlockService`).
 */
@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly worlds: WorldsRepository,
    private readonly engine: GameEngine,
    private readonly progression: ProgressionService,
    private readonly progressionManager: ProgressionManager,
    private readonly scores: ScoreService,
    private readonly statistics: StatisticsService,
    private readonly progressView: ProgressViewBuilder,
    private readonly sequences: SequenceStore,
    private readonly unlocks: WorldUnlockService,
  ) {}

  // ───────────────────────── Sesiones ─────────────────────────

  /**
   * Inicia una sesión o reanuda la abierta (idempotente). No borra progreso. Si el mundo estaba completado, la nueva
   * sesión empieza otra secuencia conservando puntos y racha. @throws ForbiddenException si el mundo está bloqueado.
   */
  async startSession(userId: string, worldSlug: string): Promise<StartSessionResponseDto> {
    const world = await this.worlds.getBySlug(worldSlug);
    return this.tx(async (tx) => {
      const locked = await this.progression.lockOrCreate(tx, userId, world);
      await this.unlocks.assertUnlocked(userId, world, tx);
      const expiredAttempt =
        (await this.settleExpired(tx, userId, world, locked.progressId)) ??
        (await this.lastUnnoticedExpiry(tx, userId, world));

      const open = await tx.gameSession.findFirst({ where: { userId, worldId: world.id, endedAt: null } });
      if (open) return { session: toSessionDto(open, worldSlug), created: false, expiredAttempt };

      const { state } = await this.progression.read(userId, world, tx);
      if (state.status === 'COMPLETED') {
        await this.progression.save(
          tx,
          locked.progressId,
          world,
          this.progressionManager.startNewRun(state),
          null,
        );
      }
      const session = await tx.gameSession.create({
        data: { userId, worldId: world.id, startedAt: this.clock.now() },
      });
      return { session: toSessionDto(session, worldSlug), created: true, expiredAttempt };
    });
  }

  /**
   * El último intento del jugador en el mundo, si lo cerró el servidor por tiempo sin respuesta (el jugador se fue).
   * Lo cierre la petición que lo cierre (p. ej. una lectura de progreso desde el mapa), el aviso sigue disponible al
   * entrar al mundo hasta que el jugador empieza otro reto.
   */
  private async lastUnnoticedExpiry(
    tx: DbClient,
    userId: string,
    world: LoadedWorld,
  ): Promise<ExpiredAttemptDto | null> {
    const latest = await tx.challengeAttempt.findFirst({
      where: { userId, worldId: world.id },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, outcome: true, submission: true, resultMessage: true },
    });
    return latest?.outcome === 'TIMEOUT' &&
      latest.submission === null &&
      latest.resultMessage === TIMEOUT_MESSAGE
      ? { attemptId: latest.id, outcome: 'TIMEOUT' }
      : null;
  }

  /** Cierra la sesión (idempotente). No se permite con un reto vigente: el plazo corre igualmente. */
  async endSession(userId: string, sessionId: string): Promise<SessionDto> {
    const owned = await this.findOwnedSession(userId, sessionId);
    const world = await this.worlds.getById(owned.worldId);
    return this.tx(async (tx) => {
      const locked = await this.progression.lockOrCreate(tx, userId, world);
      await this.settleExpired(tx, userId, world, locked.progressId);

      const session = await tx.gameSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (session.endedAt) return toSessionDto(session, world.definition.slug);

      const pending = await tx.challengeAttempt.findFirst({
        where: { userId, worldId: world.id, outcome: 'PENDING' },
      });
      if (pending)
        throw new ConflictException('Hay un reto en curso; respóndelo o espera a que venza su plazo.');

      const ended = await tx.gameSession.update({
        where: { id: sessionId },
        data: { endedAt: this.clock.now() },
      });
      return toSessionDto(ended, world.definition.slug);
    });
  }

  // ───────────────────────── Retos ─────────────────────────

  /**
   * Inicia el reto actual (el plazo corre desde aquí) o devuelve el intento abierto si ya existe. Sin secuencia
   * activa, planifica una nueva (subconjunto y orden de reglas sorteados). Si el intento abierto había vencido, se
   * cierra como TIMEOUT (secuencia fallida) y se inicia el reto 1 de una secuencia nueva.
   */
  async startAttempt(userId: string, sessionId: string): Promise<ChallengeAttemptDto> {
    const owned = await this.findOwnedSession(userId, sessionId);
    const world = await this.worlds.getById(owned.worldId);

    return this.tx(async (tx) => {
      const locked = await this.progression.lockOrCreate(tx, userId, world);
      const session = await tx.gameSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (session.endedAt) throw new ConflictException('La sesión ya terminó; inicia una nueva.');
      // Defensa en profundidad: una sesión abierta no permite saltarse el desbloqueo ni jugar un mundo deshabilitado.
      if (!world.isEnabled)
        throw new NotFoundException(`El mundo "${world.definition.slug}" no está disponible.`);
      await this.unlocks.assertUnlocked(userId, world, tx);

      const expired = await this.settleExpired(tx, userId, world, locked.progressId);

      const open = await tx.challengeAttempt.findFirst({
        where: { userId, worldId: world.id, outcome: 'PENDING' },
        include: ATTEMPT_INCLUDE,
      });
      if (open) {
        const sequence = await this.sequenceOf(tx, open, world);
        return this.toChallengeDto(open, world, sequence, true, expired);
      }

      let { state } = await this.progression.read(userId, world, tx);
      if (state.status === 'COMPLETED')
        throw new ConflictException('Mundo completado; inicia una nueva sesión.');

      let sequence = await this.sequences.findActive(tx, userId, world);
      if (!sequence) {
        // Toda secuencia nueva empieza en el reto 1 sin reglas (p. ej. tras un fallo o tras completar el mundo).
        if (state.currentPosition !== 1 || state.unlockedRuleIds.length > 0) {
          state = { ...state, currentPosition: 1, unlockedRuleIds: [] };
          await this.progression.save(tx, locked.progressId, world, state, null);
        }
        sequence = await this.sequences.open(tx, userId, world, state);
      }

      const now = this.clock.now();
      const active = this.engine.startChallenge(state, world.definition, sequence.playable, now);
      const created = await tx.challengeAttempt.create({
        data: {
          sessionId,
          userId,
          worldId: world.id,
          sequenceChallengeId: active.challenge.id,
          position: active.challenge.position,
          expression: active.challenge.expression,
          outcome: 'PENDING',
          activeRuleKeys: active.activeRules.map((rule) => rule.id),
          activeRulesCount: active.activeRules.length,
          timeLimitSeconds: active.timeLimitSeconds,
          startedAt: active.startedAt,
          deadlineAt: active.deadlineAt,
          streakBefore: active.streakBefore,
        },
        include: ATTEMPT_INCLUDE,
      });
      return this.toChallengeDto(created, world, sequence, false, expired);
    });
  }

  /** Intento abierto de la sesión (cierra antes por tiempo uno vencido). `null` si no hay ninguno. */
  async getCurrentAttempt(userId: string, sessionId: string): Promise<ChallengeAttemptDto | null> {
    const owned = await this.findOwnedSession(userId, sessionId);
    const world = await this.worlds.getById(owned.worldId);
    await this.settleOverdue(userId, world);

    const open = await this.prisma.challengeAttempt.findFirst({
      where: { userId, worldId: world.id, outcome: 'PENDING', sessionId },
      include: ATTEMPT_INCLUDE,
    });
    if (!open) return null;
    const sequence = await this.sequenceOf(this.prisma, open, world);
    return this.toChallengeDto(open, world, sequence, true, null);
  }

  /**
   * Resuelve el único intento del reto. Solo recibe la expresión; todo lo demás sale del servidor.
   * Idempotente: repetir el mismo envío devuelve el resultado original (`replayed: true`).
   */
  async submitAnswer(userId: string, attemptId: string, expression: string): Promise<AnswerResultDto> {
    const owned = await this.prisma.challengeAttempt.findFirst({
      where: { id: attemptId, userId },
      select: { worldId: true },
    });
    if (!owned) throw new NotFoundException('Intento no encontrado.');
    const world = await this.worlds.getById(owned.worldId);

    return this.tx(async (tx) => {
      const locked = await this.progression.lockOrCreate(tx, userId, world);
      // Un reto que ya no se puede jugar se retira (queda resuelto: la respuesta devuelve ese cierre).
      await this.retireUnplayable(tx, userId, world, locked.progressId);
      // Releer TRAS el bloqueo: otra petición pudo resolverlo mientras esperábamos.
      const attempt = await tx.challengeAttempt.findFirstOrThrow({
        where: { id: attemptId, userId },
        include: ATTEMPT_INCLUDE,
      });

      if (attempt.outcome !== 'PENDING') return this.replay(tx, attempt, expression, world, userId);

      const sequence = await this.sequenceOf(tx, attempt, world);
      // Un único instante del servidor decide plazo y registro.
      const submittedAt = this.clock.now();
      let result: AttemptResult;
      try {
        result = this.engine.submitAnswer({
          state: locked.state,
          world: world.definition,
          sequence: sequence.playable,
          activeChallenge: this.toActiveChallenge(attempt, world, sequence),
          submission: expression,
          submittedAt,
        });
      } catch (error) {
        if (error instanceof GameStateError) throw new ConflictException(error.message);
        throw error;
      }

      await this.persistResolution(tx, {
        userId,
        world,
        progressId: locked.progressId,
        attempt,
        sequenceId: sequence.row.id,
        result,
        submission: expression,
        submittedAt,
        now: submittedAt,
      });
      return this.buildAnswerResult(tx, attemptId, userId, world, false);
    });
  }

  // ───────────────────────── Expiración perezosa ─────────────────────────

  /**
   * Cierra como TIMEOUT un intento vencido (si lo hay). Pensado para lecturas: solo abre
   * transacción cuando existe un intento vencido. Es determinista e idempotente.
   */
  async settleOverdue(userId: string, world: LoadedWorld): Promise<void> {
    const pending = await this.prisma.challengeAttempt.findFirst({
      where: { userId, worldId: world.id, outcome: 'PENDING' },
      select: { deadlineAt: true, sequenceChallengeId: true, activeRuleKeys: true },
    });
    if (!pending) return;
    const overdue = pending.deadlineAt.getTime() < this.clock.now().getTime();
    if (!overdue && this.isPlayableAttempt(pending, world)) return;
    await this.tx(async (tx) => {
      const locked = await this.progression.lockOrCreate(tx, userId, world);
      await this.settleExpired(tx, userId, world, locked.progressId);
    });
  }

  /** Requiere el bloqueo de progreso del jugador. Antes retira lo que ya no se pueda jugar. */
  private async settleExpired(
    tx: DbClient,
    userId: string,
    world: LoadedWorld,
    progressId: string,
  ): Promise<ExpiredAttemptDto | null> {
    await this.retireUnplayable(tx, userId, world, progressId);
    const pending = await tx.challengeAttempt.findFirst({
      where: { userId, worldId: world.id, outcome: 'PENDING' },
      include: ATTEMPT_INCLUDE,
    });
    const now = this.clock.now();
    if (!pending || now.getTime() <= pending.deadlineAt.getTime()) return null;

    const sequence = await this.sequenceOf(tx, pending, world);
    const { state } = await this.progression.read(userId, world, tx);
    const result = this.engine.expireChallenge(state, this.toActiveChallenge(pending, world, sequence), now);
    await this.persistResolution(tx, {
      userId,
      world,
      progressId,
      attempt: pending,
      sequenceId: sequence.row.id,
      result,
      submission: null,
      submittedAt: null,
      now,
    });
    return { attemptId: pending.id, outcome: 'TIMEOUT' };
  }

  // ───────────────────────── Estado que ya no se puede jugar ─────────────────────────

  /** Un intento abierto se puede jugar si pertenece a una secuencia generada y todas sus reglas siguen en el catálogo. */
  private isPlayableAttempt(
    attempt: { sequenceChallengeId: string | null; activeRuleKeys: readonly string[] },
    world: LoadedWorld,
  ): boolean {
    const known = new Set(world.definition.rules.map((rule) => rule.id));
    return attempt.sequenceChallengeId !== null && attempt.activeRuleKeys.every((key) => known.has(key));
  }

  /**
   * Requiere el bloqueo de progreso. Retira, SIN culpa del jugador, una secuencia ACTIVE que use reglas que el catálogo
   * ya no tiene (p. ej. una regla renombrada en un despliegue) y el intento abierto que no se pueda evaluar (de esa
   * secuencia o del catálogo fijo antiguo). El intento queda `TIMEOUT` con un mensaje explicativo y sin efecto en racha,
   * puntos ni estadísticas; la secuencia queda `FAILED` y el jugador vuelve al reto 1 (el siguiente reto sortea otra).
   * Sin esto, un cambio de catálogo dejaría al jugador bloqueado con errores 500.
   */
  private async retireUnplayable(
    tx: DbClient,
    userId: string,
    world: LoadedWorld,
    progressId: string,
  ): Promise<void> {
    const known = new Set(world.definition.rules.map((rule) => rule.id));
    const [sequence, pending] = await Promise.all([
      tx.gameSequence.findFirst({
        where: { userId, worldId: world.id, status: 'ACTIVE' },
        select: { id: true, ruleKeys: true },
      }),
      tx.challengeAttempt.findFirst({
        where: { userId, worldId: world.id, outcome: 'PENDING' },
        select: { id: true, sequenceChallengeId: true, activeRuleKeys: true, timeLimitSeconds: true },
      }),
    ]);
    const staleSequence = sequence !== null && sequence.ruleKeys.some((key) => !known.has(key));
    const stalePending = pending !== null && (staleSequence || !this.isPlayableAttempt(pending, world));
    if (!staleSequence && !stalePending) return;

    if (pending && stalePending) {
      await tx.challengeAttempt.updateMany({
        where: { id: pending.id, outcome: 'PENDING' },
        data: {
          outcome: 'TIMEOUT',
          failureReason: 'TIMEOUT',
          elapsedMs: Math.min(pending.timeLimitSeconds * 1000, INT_MAX),
          resultMessage: RETIRED_ATTEMPT_MESSAGE,
        },
      });
    }
    if (sequence) await this.sequences.close(tx, sequence.id, 'FAILED');
    await tx.studentWorldProgress.updateMany({
      where: { id: progressId, status: 'IN_PROGRESS' },
      data: { currentPosition: 1 },
    });
    this.logger.warn(
      `Retirado estado no jugable de ${userId} en "${world.definition.slug}" (secuencia ${sequence?.id ?? '—'}, intento ${pending?.id ?? '—'}).`,
    );
  }

  // ───────────────────────── Persistencia atómica ─────────────────────────

  /**
   * Escribe intento, progreso, regla dominada, puntos, estadísticas, cierre de secuencia (fallida o completada)
   * y cierre de sesión al completar el mundo; todo o nada.
   */
  private async persistResolution(tx: DbClient, r: Resolution): Promise<void> {
    const { result, attempt } = r;
    const violations: ViolationDto[] = (result.evaluation?.violations ?? []).map((v) => ({
      ruleKey: v.ruleId,
      ruleType: v.ruleType,
      description: v.description,
      message: v.message,
    }));

    // Transición PENDING → resuelto, una sola vez. Si otra transacción lo resolvió, abortamos sin efectos.
    const claimed = await tx.challengeAttempt.updateMany({
      where: { id: attempt.id, outcome: 'PENDING' },
      data: {
        outcome: result.outcome,
        failureReason: result.failureReason,
        submission: r.submission,
        evaluatedValue: result.evaluation?.value ?? null,
        submittedAt: r.submittedAt,
        elapsedMs: Math.min(
          result.outcome === 'TIMEOUT' ? attempt.timeLimitSeconds * 1000 : result.elapsedMs,
          INT_MAX,
        ),
        resultMessage: result.message,
        unlockedRuleKey: result.unlockedRuleId,
        pointsAwarded: result.award.points,
        violations: violations.length > 0 ? (violations as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
    if (claimed.count !== 1) throw new ConflictException('El reto ya fue resuelto.');

    await this.progression.save(tx, r.progressId, r.world, result.state, result.unlockedRuleId, r.now);

    if (result.outcome === 'CORRECT') {
      await this.scores.recordCorrectAnswer(tx, {
        userId: r.userId,
        worldId: r.world.id,
        attemptId: attempt.id,
        award: result.award,
      });
    }

    await this.statistics.recordAttempt(tx, {
      userId: r.userId,
      worldId: r.world.id,
      outcome: result.outcome,
      elapsedMs: result.elapsedMs,
      violatedRuleKeys: violations.map((v) => v.ruleKey),
    });

    if (result.sequenceRestarted) {
      // Fallo o timeout: la secuencia y sus reglas se descartan; el próximo reto sorteará otra.
      await this.sequences.close(tx, r.sequenceId, 'FAILED');
    } else if (result.worldCompleted) {
      // Completar el mundo cierra secuencia y sesión; una nueva sesión empezará otra secuencia.
      await this.sequences.close(tx, r.sequenceId, 'COMPLETED');
      await tx.gameSession.update({ where: { id: attempt.sessionId }, data: { endedAt: this.clock.now() } });
    }
  }

  // ───────────────────────── Mapeos ─────────────────────────

  private async replay(
    tx: DbClient,
    attempt: AttemptRow,
    expression: string,
    world: LoadedWorld,
    userId: string,
  ): Promise<AnswerResultDto> {
    const sameSubmission = attempt.submission === expression;
    const closedByServer = attempt.outcome === 'TIMEOUT' && attempt.submission === null;
    if (!sameSubmission && !closedByServer) {
      throw new ConflictException(
        'Este reto ya fue resuelto con otra respuesta; solo hay un intento por reto.',
      );
    }
    return this.buildAnswerResult(tx, attempt.id, userId, world, true);
  }

  /** Resultado de un intento resuelto; se reconstruye solo con datos guardados (idéntico en un reenvío). */
  private async buildAnswerResult(
    db: DbClient,
    attemptId: string,
    userId: string,
    world: LoadedWorld,
    replayed: boolean,
  ): Promise<AnswerResultDto> {
    const attempt = await db.challengeAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { ...ATTEMPT_INCLUDE, scoreTransaction: true },
    });
    const rulesByKey = new Map(world.definition.rules.map((rule) => [rule.id, rule]));
    const unlocked = attempt.unlockedRuleKey ? rulesByKey.get(attempt.unlockedRuleKey) : undefined;
    const outcome = attempt.outcome as AnswerResultDto['outcome'];
    const score = attempt.scoreTransaction;

    // Los intentos del catálogo fijo anterior (sin secuencia) no pueden haber completado una secuencia.
    const sequenceLength = attempt.sequenceChallenge
      ? await db.sequenceChallenge.count({ where: { sequenceId: attempt.sequenceChallenge.sequenceId } })
      : null;
    const worldCompleted =
      outcome === 'CORRECT' && sequenceLength !== null && attempt.position === sequenceLength;
    const progress = await this.progressView.build(db, userId, world);

    return {
      attemptId: attempt.id,
      outcome,
      failureReason: attempt.failureReason,
      message: attempt.resultMessage ?? '',
      evaluatedValue: attempt.evaluatedValue,
      violations: parseViolations(attempt.violations),
      score: {
        basePoints: score?.basePoints ?? 0,
        multiplierMilli: score?.multiplierMilli ?? 0,
        multiplier: formatMultiplier(score?.multiplierMilli ?? 0),
        points: attempt.pointsAwarded,
      },
      unlockedRule: unlocked ? toRuleDto(unlocked) : null,
      sequenceRestarted: outcome !== 'CORRECT',
      discardedRules:
        outcome === 'CORRECT'
          ? []
          : attempt.activeRuleKeys.flatMap((key) => {
              const rule = rulesByKey.get(key);
              return rule ? [toRuleDto(rule)] : [];
            }),
      worldCompleted,
      nextWorldUnlocked: worldCompleted
        ? await this.firstUnlockBy(db, attempt, progress.firstCompletedAt, world)
        : null,
      progress,
      replayed,
    };
  }

  /** El siguiente mundo, si ESTE acierto fue la primera compleción del mundo (la que lo desbloqueó). */
  private async firstUnlockBy(
    db: DbClient,
    attempt: ChallengeAttempt,
    firstCompletedAt: Date | null,
    world: LoadedWorld,
  ): Promise<WorldRefDto | null> {
    if (!firstCompletedAt || attempt.submittedAt?.getTime() !== firstCompletedAt.getTime()) return null;
    const next = await this.unlocks.next(world, db);
    return next
      ? { slug: next.definition.slug, name: next.definition.name, position: next.definition.position }
      : null;
  }

  private toChallengeDto(
    attempt: AttemptRow,
    world: LoadedWorld,
    sequence: StoredSequence,
    resumed: boolean,
    expired: ExpiredAttemptDto | null,
  ): ChallengeAttemptDto {
    const active = this.toActiveChallenge(attempt, world, sequence);
    const now = this.clock.now();
    const newRule = active.challenge.introducesRuleId
      ? active.activeRules.find((rule) => rule.id === active.challenge.introducesRuleId)
      : undefined;
    const statementKind = active.challenge.statementKind ?? 'EXPRESSION';
    return {
      attemptId: attempt.id,
      sessionId: attempt.sessionId,
      worldSlug: world.definition.slug,
      sequenceId: sequence.row.id,
      difficulty: sequence.row.difficulty as DifficultyDto,
      position: active.challenge.position,
      challengeCount: sequence.playable.challenges.length,
      statementKind,
      expression: active.challenge.expression,
      instruction: instructionFor(statementKind, active.activeRules.length),
      syntax: { decimals: world.definition.syntax.decimals, powers: world.definition.syntax.powers },
      rules: active.activeRules.map(toRuleDto),
      newRule: newRule ? toRuleDto(newRule) : null,
      timeLimitSeconds: active.timeLimitSeconds,
      startedAt: active.startedAt,
      deadlineAt: active.deadlineAt,
      serverTime: now,
      remainingMs: Math.max(0, active.deadlineAt.getTime() - now.getTime()),
      resumed,
      expiredAttempt: expired,
    };
  }

  /** Secuencia del intento (los intentos abiertos siempre pertenecen a una secuencia generada). */
  private async sequenceOf(
    db: DbClient | PrismaService,
    attempt: AttemptRow,
    world: LoadedWorld,
  ): Promise<StoredSequence> {
    if (!attempt.sequenceChallenge) {
      throw new Error(`El intento ${attempt.id} no pertenece a ninguna secuencia generada.`);
    }
    return this.sequences.findById(db as DbClient, attempt.sequenceChallenge.sequenceId, world);
  }

  /** Reconstruye el reto en curso a partir de lo persistido (plazo y reglas quedaron fijados al iniciarlo). */
  private toActiveChallenge(
    attempt: AttemptRow,
    world: LoadedWorld,
    sequence: StoredSequence,
  ): ActiveChallenge {
    const challenge: ChallengeDefinition | undefined = sequence.playable.challenges.find(
      (c) => c.id === attempt.sequenceChallengeId,
    );
    if (!challenge) throw new Error(`Reto desconocido en la secuencia: ${attempt.sequenceChallengeId}`);
    const activeRules = attempt.activeRuleKeys.map((key) => {
      const rule = world.definition.rules.find((r) => r.id === key);
      if (!rule) throw new Error(`Regla desconocida en el catálogo: ${key}`);
      return rule;
    });
    return {
      challenge,
      activeRules,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      timeLimitSeconds: attempt.timeLimitSeconds,
      streakBefore: attempt.streakBefore,
    };
  }

  /** Sesión propia o 404 (no se distingue "no existe" de "es de otro" para no filtrar información). */
  private async findOwnedSession(userId: string, sessionId: string) {
    const session = await this.prisma.gameSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Sesión no encontrada.');
    return session;
  }

  private tx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, TX_OPTIONS);
  }
}

/** Texto que indica al jugador qué escribir (lo decide el servidor, no el cliente). */
export function instructionFor(kind: 'EXPRESSION' | 'EQUATION', activeRules: number): string {
  const rules = activeRules > 0 ? ' y que cumpla todas las reglas activas' : '';
  return kind === 'EQUATION'
    ? `Resuelve la ecuación: escribe una expresión cuyo valor sea x${rules}.`
    : `Escribe una expresión que valga lo mismo que la operación${rules}.`;
}
