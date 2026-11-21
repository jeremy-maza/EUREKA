import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../common';
import { ChallengeAttempt, Prisma } from '../../generated/prisma/client';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { ProgressionManager, ProgressionService } from '../progression';
import { ScoreService, formatMultiplier } from '../scoring';
import { StatisticsService } from '../statistics';
import { LoadedWorld, WorldsRepository } from '../worlds';
import {
  AnswerResultDto,
  ChallengeAttemptDto,
  ExpiredAttemptDto,
  SessionDto,
  StartSessionResponseDto,
  ViolationDto,
} from './dto/game.dto';
import { GameEngine, GameStateError } from './game-engine';
import { ActiveChallenge, AttemptResult } from './game.types';
import { parseViolations, toRuleDto, toSessionDto } from './game.mappers';
import { ProgressViewBuilder } from './progress-view.builder';

type AttemptRow = ChallengeAttempt & { challenge: { key: string } };

interface Resolution {
  userId: string;
  world: LoadedWorld;
  progressId: string;
  attempt: AttemptRow;
  result: AttemptResult;
  /** Texto enviado por el jugador (null si el servidor cerró el intento por tiempo). */
  submission: string | null;
  submittedAt: Date | null;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
const INT_MAX = 2_147_483_647;

/**
 * Capa de aplicación del juego. Orquesta el motor puro (`GameEngine`) con la persistencia.
 *
 * Garantías de integridad:
 *  - El servidor es la única fuente de tiempo (`Clock`), de puntuación, rachas y reglas.
 *  - Cada operación que cambia el estado de un jugador/mundo corre en UNA transacción que antes
 *    BLOQUEA la fila de progreso (`FOR UPDATE`): no hay carreras entre responder, iniciar o expirar.
 *  - La resolución de un intento es de una sola vez: `UPDATE … WHERE outcome = 'PENDING'`,
 *    `ScoreTransaction.attemptId` único y un reenvío idéntico devuelve el resultado original.
 */
@Injectable()
export class GameService {
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
  ) {}

  // ───────────────────────── Sesiones ─────────────────────────

  /**
   * Inicia una sesión o reanuda la abierta (idempotente). No borra reglas ni progreso. Si el mundo
   * estaba completado, la nueva sesión reinicia la secuencia conservando reglas, puntos y racha.
   */
  async startSession(userId: string, worldSlug: string): Promise<StartSessionResponseDto> {
    const world = await this.worlds.getBySlug(worldSlug);
    return this.tx(async (tx) => {
      const locked = await this.progression.lockOrCreate(tx, userId, world);
      await this.settleExpired(tx, userId, world, locked.progressId);

      const open = await tx.gameSession.findFirst({ where: { userId, worldId: world.id, endedAt: null } });
      if (open) return { session: toSessionDto(open, worldSlug), created: false };

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
      return { session: toSessionDto(session, worldSlug), created: true };
    });
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
   * Inicia el reto actual (el plazo corre desde aquí) o devuelve el intento abierto si ya existe.
   * Si el intento abierto había vencido, se cierra como TIMEOUT (secuencia reiniciada) y se inicia uno nuevo.
   */
  async startAttempt(userId: string, sessionId: string): Promise<ChallengeAttemptDto> {
    const owned = await this.findOwnedSession(userId, sessionId);
    const world = await this.worlds.getById(owned.worldId);

    return this.tx(async (tx) => {
      const locked = await this.progression.lockOrCreate(tx, userId, world);
      const session = await tx.gameSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (session.endedAt) throw new ConflictException('La sesión ya terminó; inicia una nueva.');

      const expired = await this.settleExpired(tx, userId, world, locked.progressId);

      const open = await tx.challengeAttempt.findFirst({
        where: { userId, worldId: world.id, outcome: 'PENDING' },
        include: { challenge: { select: { key: true } } },
      });
      if (open) return this.toChallengeDto(open, world, true, expired);

      const { state } = await this.progression.read(userId, world, tx);
      if (state.status === 'COMPLETED')
        throw new ConflictException('Mundo completado; inicia una nueva sesión.');

      const now = this.clock.now();
      const active = this.engine.startChallenge(state, world.definition, now);
      const created = await tx.challengeAttempt.create({
        data: {
          sessionId,
          userId,
          worldId: world.id,
          challengeId: this.challengeRowId(world, active),
          outcome: 'PENDING',
          activeRuleKeys: active.activeRules.map((rule) => rule.id),
          activeRulesCount: active.activeRules.length,
          timeLimitSeconds: active.timeLimitSeconds,
          startedAt: active.startedAt,
          deadlineAt: active.deadlineAt,
          streakBefore: active.streakBefore,
        },
        include: { challenge: { select: { key: true } } },
      });
      return this.toChallengeDto(created, world, false, expired);
    });
  }

  /** Intento abierto de la sesión (cierra antes por tiempo uno vencido). `null` si no hay ninguno. */
  async getCurrentAttempt(userId: string, sessionId: string): Promise<ChallengeAttemptDto | null> {
    const owned = await this.findOwnedSession(userId, sessionId);
    const world = await this.worlds.getById(owned.worldId);
    await this.settleOverdue(userId, world);

    const open = await this.prisma.challengeAttempt.findFirst({
      where: { userId, worldId: world.id, outcome: 'PENDING', sessionId },
      include: { challenge: { select: { key: true } } },
    });
    return open ? this.toChallengeDto(open, world, true, null) : null;
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
      // Releer TRAS el bloqueo: otra petición pudo resolverlo mientras esperábamos.
      const attempt = await tx.challengeAttempt.findFirstOrThrow({
        where: { id: attemptId, userId },
        include: { challenge: { select: { key: true } } },
      });

      if (attempt.outcome !== 'PENDING') return this.replay(tx, attempt, expression, world, userId);

      // Un único instante del servidor decide plazo y registro.
      const submittedAt = this.clock.now();
      let result: AttemptResult;
      try {
        result = this.engine.submitAnswer({
          state: locked.state,
          world: world.definition,
          activeChallenge: this.toActiveChallenge(attempt, world),
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
        result,
        submission: expression,
        submittedAt,
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
    const overdue = await this.prisma.challengeAttempt.findFirst({
      where: { userId, worldId: world.id, outcome: 'PENDING', deadlineAt: { lt: this.clock.now() } },
      select: { id: true },
    });
    if (!overdue) return;
    await this.tx(async (tx) => {
      const locked = await this.progression.lockOrCreate(tx, userId, world);
      await this.settleExpired(tx, userId, world, locked.progressId);
    });
  }

  /** Requiere el bloqueo de progreso del jugador. */
  private async settleExpired(
    tx: DbClient,
    userId: string,
    world: LoadedWorld,
    progressId: string,
  ): Promise<ExpiredAttemptDto | null> {
    const pending = await tx.challengeAttempt.findFirst({
      where: { userId, worldId: world.id, outcome: 'PENDING' },
      include: { challenge: { select: { key: true } } },
    });
    const now = this.clock.now();
    if (!pending || now.getTime() <= pending.deadlineAt.getTime()) return null;

    const { state } = await this.progression.read(userId, world, tx);
    const result = this.engine.expireChallenge(state, this.toActiveChallenge(pending, world), now);
    await this.persistResolution(tx, {
      userId,
      world,
      progressId,
      attempt: pending,
      result,
      submission: null,
      submittedAt: null,
    });
    return { attemptId: pending.id, outcome: 'TIMEOUT' };
  }

  // ───────────────────────── Persistencia atómica ─────────────────────────

  /** Escribe intento, progreso, regla desbloqueada, puntos, estadísticas y cierre de sesión; todo o nada. */
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

    await this.progression.save(tx, r.progressId, r.world, result.state, result.unlockedRuleId);

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

    // Completar el mundo cierra la sesión; una nueva sesión reiniciará la secuencia.
    if (result.worldCompleted) {
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

  private async buildAnswerResult(
    db: DbClient,
    attemptId: string,
    userId: string,
    world: LoadedWorld,
    replayed: boolean,
  ): Promise<AnswerResultDto> {
    const attempt = await db.challengeAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { challenge: { select: { key: true } }, scoreTransaction: true },
    });
    const challenge = world.definition.challenges.find((c) => c.id === attempt.challenge.key);
    const unlocked = attempt.unlockedRuleKey
      ? world.definition.rules.find((rule) => rule.id === attempt.unlockedRuleKey)
      : undefined;
    const outcome = attempt.outcome as AnswerResultDto['outcome'];
    const tx = attempt.scoreTransaction;

    return {
      attemptId: attempt.id,
      outcome,
      failureReason: attempt.failureReason,
      message: attempt.resultMessage ?? '',
      evaluatedValue: attempt.evaluatedValue,
      violations: parseViolations(attempt.violations),
      score: {
        basePoints: tx?.basePoints ?? 0,
        multiplierMilli: tx?.multiplierMilli ?? 0,
        multiplier: formatMultiplier(tx?.multiplierMilli ?? 0),
        points: attempt.pointsAwarded,
      },
      unlockedRule: unlocked ? toRuleDto(unlocked) : null,
      sequenceRestarted: outcome !== 'CORRECT',
      worldCompleted: outcome === 'CORRECT' && challenge?.position === world.definition.challenges.length,
      progress: await this.progressView.build(db, userId, world),
      replayed,
    };
  }

  private toChallengeDto(
    attempt: AttemptRow,
    world: LoadedWorld,
    resumed: boolean,
    expired: ExpiredAttemptDto | null,
  ): ChallengeAttemptDto {
    const active = this.toActiveChallenge(attempt, world);
    const now = this.clock.now();
    const newRule = active.challenge.introducesRuleId
      ? active.activeRules.find((rule) => rule.id === active.challenge.introducesRuleId)
      : undefined;
    return {
      attemptId: attempt.id,
      sessionId: attempt.sessionId,
      worldSlug: world.definition.slug,
      position: active.challenge.position,
      challengeCount: world.definition.challenges.length,
      expression: active.challenge.expression,
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

  /** Reconstruye el reto en curso a partir de lo persistido (plazo y reglas quedaron fijados al iniciarlo). */
  private toActiveChallenge(attempt: AttemptRow, world: LoadedWorld): ActiveChallenge {
    const challenge = world.definition.challenges.find((c) => c.id === attempt.challenge.key);
    if (!challenge) throw new Error(`Reto desconocido en el catálogo: ${attempt.challenge.key}`);
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

  private challengeRowId(world: LoadedWorld, active: ActiveChallenge): string {
    const id = world.challengeRowIds.get(active.challenge.id);
    if (!id) throw new Error(`Reto sin fila en BD: ${active.challenge.id}`);
    return id;
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
