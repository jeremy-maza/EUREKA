import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, Clock } from '../../common';
import { PrismaService } from '../../prisma/prisma.service';
import { toHistoryItem } from '../game/game.mappers';
import {
  assignedToTeacher,
  GROUP_WITH_COUNTS,
  GroupAccessService,
  ListStudentsQueryDto,
  MembershipsService,
  PERSON_SELECT,
  toGroupDto,
} from '../groups';
import { ProgressionService, ProgressSummary } from '../progression';
import {
  AttemptAnalyticsService,
  ChallengeOutcomeRow,
  StatisticsService,
  UserActivity,
  WorldStatisticsRow,
} from '../statistics';
import { LoadedWorld, WorldsRepository } from '../worlds';
import {
  ActivitySummaryDto,
  ChallengeDifficultyDto,
  CommonErrorDto,
  GroupDashboardDto,
  GroupStatisticsDto,
  MetricsDto,
  StatisticsQueryDto,
  StudentAttemptsQueryDto,
  StudentAttemptPageDto,
  StudentAttentionDto,
  StudentOverviewDto,
  StudentOverviewPageDto,
  StudentStatisticsDto,
  StudentWorldDto,
  StudentWorldStatisticsDto,
  TeacherDashboardDto,
  ViolatedRuleDto,
  WorldPerformanceDto,
} from './dto/dashboard.dto';
import {
  accuracyPercent,
  addMetrics,
  attentionReasons,
  averageCorrectMs,
  emptyMetrics,
  percent,
  RawMetrics,
} from './metrics';

const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const key = (userId: string, worldId: string): string => `${userId}:${worldId}`;

/** Datos de un conjunto YA AUTORIZADO de estudiantes, cargados con consultas agrupadas (sin N+1). */
interface Dataset {
  worlds: LoadedWorld[];
  progress: Map<string, ProgressSummary>;
  stats: Map<string, WorldStatisticsRow>;
  completed: Map<string, number>;
  activity: Map<string, UserActivity>;
  recentActivity: Map<string, UserActivity>;
}

const toMetricsDto = (raw: RawMetrics): MetricsDto => ({
  points: raw.points,
  attempts: raw.attempts,
  correct: raw.correct,
  incorrect: raw.incorrect,
  timeouts: raw.timeouts,
  accuracyPercent: accuracyPercent(raw.correct, raw.attempts),
  averageCorrectResponseTimeMs: averageCorrectMs(raw.totalCorrectElapsedMs, raw.correct),
});

/**
 * Panel docente. REGLA: cada método público empieza autorizando con `GroupAccessService` (grupo asignado y,
 * para un estudiante, membresía activa) y solo entonces consulta datos, pasando a los agregados únicamente
 * los ids de estudiantes ya autorizados. Reutiliza `ProgressionService`, `StatisticsService` y
 * `AttemptAnalyticsService`; no mantiene agregados propios.
 *
 * Los intentos vencidos que el estudiante aún no ha "cerrado" (PENDING pasado de plazo) se contabilizan
 * cuando el servidor los resuelve (al volver a jugar o consultar su estado): una lectura del docente no
 * escribe en datos del estudiante.
 */
@Injectable()
export class TeacherDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly memberships: MembershipsService,
    private readonly worlds: WorldsRepository,
    private readonly progression: ProgressionService,
    private readonly statistics: StatisticsService,
    private readonly analytics: AttemptAnalyticsService,
    private readonly clock: Clock,
  ) {}

  // ───────────── Panel general ─────────────

  async overview(teacher: AuthenticatedUser): Promise<TeacherDashboardDto> {
    const groups = await this.prisma.group.findMany({
      where: { status: 'ACTIVE', ...assignedToTeacher(teacher.id) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: GROUP_WITH_COUNTS,
    });
    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: { in: groups.map((g) => g.id) }, status: 'ACTIVE' },
      select: { groupId: true, userId: true },
    });
    const membersByGroup = new Map<string, string[]>();
    for (const { groupId, userId } of members) {
      membersByGroup.set(groupId, [...(membersByGroup.get(groupId) ?? []), userId]);
    }

    const dataset = await this.loadDataset([...new Set(members.map((m) => m.userId))]);
    return {
      generatedAt: this.clock.now(),
      groups: groups.map((group) => ({
        group: toGroupDto(group),
        activity: this.summarize(membersByGroup.get(group.id) ?? [], dataset),
      })),
    };
  }

  // ───────────── Panel de un grupo ─────────────

  async groupDashboard(teacher: AuthenticatedUser, groupId: string): Promise<GroupDashboardDto> {
    await this.access.requireReadable(teacher, groupId);
    const [group, memberIds] = await Promise.all([
      this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, include: GROUP_WITH_COUNTS }),
      this.access.activeMemberIds(groupId),
    ]);
    const dataset = await this.loadDataset(memberIds);
    return {
      generatedAt: this.clock.now(),
      group: toGroupDto(group),
      activity: this.summarize(memberIds, dataset),
      worlds: this.performanceByWorld(memberIds, dataset),
    };
  }

  /** Resumen de cada estudiante del grupo (paginado por cursor; búsqueda por nombre/correo). */
  async groupStudents(
    teacher: AuthenticatedUser,
    groupId: string,
    query: ListStudentsQueryDto,
  ): Promise<StudentOverviewPageDto> {
    // Autoriza, pagina y filtra (solo membresías ACTIVAS: el panel no muestra a quien ya dejó el grupo).
    const page = await this.memberships.list(teacher, groupId, { ...query, status: 'ACTIVE' });
    const dataset = await this.loadDataset(page.items.map((m) => m.student.id));
    return {
      items: page.items.map((member) => this.studentOverview(member.student, member.joinedAt, dataset)),
      nextCursor: page.nextCursor,
    };
  }

  async groupStatistics(
    teacher: AuthenticatedUser,
    groupId: string,
    query: StatisticsQueryDto,
  ): Promise<GroupStatisticsDto> {
    await this.access.requireReadable(teacher, groupId);
    const memberIds = await this.access.activeMemberIds(groupId);
    const [dataset, reasons, challengeOutcomes, trailing] = await Promise.all([
      this.loadDataset(memberIds),
      this.analytics.failureReasons(memberIds),
      this.analytics.challengeOutcomes(memberIds),
      this.analytics.trailingFailures(memberIds),
    ]);
    const worldById = new Map(dataset.worlds.map((w) => [w.id, w]));
    const thresholds = {
      minAttempts: query.minAttempts,
      lowAccuracyBelow: query.lowAccuracyBelow,
      repeatedFailures: query.repeatedFailures,
    };

    // Estudiantes que requieren atención: precisión baja (con datos suficientes) o fallos consecutivos.
    const maxTrailing = new Map<string, number>();
    for (const row of trailing) {
      if (worldById.has(row.worldId)) {
        maxTrailing.set(row.userId, Math.max(maxTrailing.get(row.userId) ?? 0, row.consecutiveFailures));
      }
    }
    const flagged = memberIds.flatMap((userId) => {
      const raw = this.rawForStudent(userId, dataset);
      const input = {
        attempts: raw.attempts,
        accuracyPercent: accuracyPercent(raw.correct, raw.attempts),
        consecutiveFailures: maxTrailing.get(userId) ?? 0,
      };
      const flags = attentionReasons(input, thresholds);
      return flags.length > 0 ? [{ userId, reasons: flags, ...input }] : [];
    });
    flagged.sort(
      (a, b) =>
        b.reasons.length - a.reasons.length ||
        (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101) ||
        b.consecutiveFailures - a.consecutiveFailures,
    );
    const topFlagged = flagged.slice(0, query.top);
    const names = await this.prisma.user.findMany({
      where: { id: { in: topFlagged.map((f) => f.userId) } },
      select: { id: true, displayName: true },
    });
    const nameById = new Map(names.map((n) => [n.id, n.displayName]));
    const studentsNeedingAttention: StudentAttentionDto[] = topFlagged.map((f) => ({
      student: { id: f.userId, displayName: nameById.get(f.userId) ?? '' },
      reasons: f.reasons,
      attempts: f.attempts,
      accuracyPercent: f.accuracyPercent,
      consecutiveFailures: f.consecutiveFailures,
    }));

    const challenges = this.challengeDifficulty(challengeOutcomes, dataset.worlds);
    return {
      generatedAt: this.clock.now(),
      studentCount: memberIds.length,
      thresholds: { ...thresholds, top: query.top },
      performanceByWorld: this.performanceByWorld(memberIds, dataset),
      commonErrors: this.commonErrors(reasons, worldById).slice(0, query.top * 2),
      frequentlyViolatedRules: this.violatedRules(memberIds, dataset)
        .sort((a, b) => b.violations - a.violations)
        .slice(0, query.top),
      challengesNeedingReinforcement: challenges
        .filter(
          (c) =>
            c.attempts >= query.minAttempts &&
            c.failureRatePercent !== null &&
            100 - c.failureRatePercent < query.lowAccuracyBelow,
        )
        .sort((a, b) => (b.failureRatePercent ?? 0) - (a.failureRatePercent ?? 0) || b.attempts - a.attempts)
        .slice(0, query.top),
      studentsNeedingAttention,
    };
  }

  // ───────────── Un estudiante dentro de un grupo ─────────────

  async studentOverviewInGroup(
    teacher: AuthenticatedUser,
    groupId: string,
    studentId: string,
  ): Promise<StudentOverviewDto> {
    const { member } = await this.authorizeStudent(teacher, groupId, studentId);
    const dataset = await this.loadDataset([studentId]);
    return this.studentOverview(member.user, member.joinedAt, dataset);
  }

  async studentStatistics(
    teacher: AuthenticatedUser,
    groupId: string,
    studentId: string,
  ): Promise<StudentStatisticsDto> {
    const { member } = await this.authorizeStudent(teacher, groupId, studentId);
    const [dataset, reasons, challengeOutcomes, trailing] = await Promise.all([
      this.loadDataset([studentId]),
      this.analytics.failureReasons([studentId]),
      this.analytics.challengeOutcomes([studentId]),
      this.analytics.trailingFailures([studentId]),
    ]);
    const outcomes = this.challengeDifficulty(challengeOutcomes, dataset.worlds);
    const violated = this.violatedRules([studentId], dataset);
    const worldById = new Map(dataset.worlds.map((w) => [w.id, w]));
    const errors = this.commonErrors(reasons, worldById);

    const worlds: StudentWorldStatisticsDto[] = dataset.worlds.map((world) => {
      const slug = world.definition.slug;
      return {
        ...this.studentWorld(studentId, world, dataset),
        consecutiveFailures: trailing.find((t) => t.worldId === world.id)?.consecutiveFailures ?? 0,
        commonErrors: errors.filter((e) => e.worldSlug === slug),
        violatedRules: violated
          .filter((v) => v.worldSlug === slug)
          .sort((a, b) => b.violations - a.violations),
        // Una fila por posición posible de la secuencia (la más larga es la de dificultad máxima).
        challenges: Array.from({ length: maxSequenceLength(world) }, (_, index) => index + 1).map(
          (position) =>
            outcomes.find((o) => o.worldSlug === slug && o.position === position) ??
            this.emptyChallenge(slug, position, ''),
        ),
      };
    });
    return { generatedAt: this.clock.now(), student: member.user, worlds };
  }

  /** Historial de intentos RESUELTOS del estudiante (paginado por cursor, más recientes primero). */
  async studentAttempts(
    teacher: AuthenticatedUser,
    groupId: string,
    studentId: string,
    query: StudentAttemptsQueryDto,
  ): Promise<StudentAttemptPageDto> {
    await this.authorizeStudent(teacher, groupId, studentId);
    const worlds = query.worldSlug
      ? [await this.worlds.getBySlug(query.worldSlug)]
      : await this.worlds.listEnabled();
    const worldById = new Map(worlds.map((w) => [w.id, w]));

    const rows = await this.prisma.challengeAttempt.findMany({
      where: {
        userId: studentId,
        worldId: { in: [...worldById.keys()] },
        outcome: { not: 'PENDING' },
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.flatMap((row) => {
        const world = worldById.get(row.worldId);
        return world ? [{ ...toHistoryItem(row), worldSlug: world.definition.slug }] : [];
      }),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
    };
  }

  // ───────────── Internos ─────────────

  /** Grupo asignado Y estudiante con membresía activa en él; si no, 404 (sin revelar nada más). */
  private async authorizeStudent(teacher: AuthenticatedUser, groupId: string, studentId: string) {
    await this.access.requireReadable(teacher, groupId);
    await this.access.requireActiveMember(groupId, studentId);
    const member = await this.prisma.groupMembership.findFirst({
      where: { groupId, userId: studentId, status: 'ACTIVE' },
      include: { user: { select: PERSON_SELECT } },
    });
    if (!member) throw new NotFoundException('El estudiante no pertenece a este grupo.');
    return { member };
  }

  private async loadDataset(userIds: string[]): Promise<Dataset> {
    const worlds = await this.worlds.listEnabled();
    const worldIds = worlds.map((w) => w.id);
    const since = new Date(this.clock.now().getTime() - ACTIVITY_WINDOW_MS);
    const [progress, stats, completed, activity, recent] = await Promise.all([
      this.progression.listSummaries(userIds, worldIds),
      this.statistics.getMany(userIds, worldIds),
      this.analytics.completedChallenges(userIds, worldIds),
      this.analytics.activityByUser(userIds),
      this.analytics.activityByUser(userIds, since),
    ]);
    return {
      worlds,
      progress: new Map(progress.map((p) => [key(p.userId, p.worldId), p])),
      stats: new Map(stats.map((s) => [key(s.userId, s.worldId), s])),
      completed: new Map(completed.map((c) => [key(c.userId, c.worldId), c.distinctChallenges])),
      activity: new Map(activity.map((a) => [a.userId, a])),
      recentActivity: new Map(recent.map((a) => [a.userId, a])),
    };
  }

  private rawFor(userId: string, worldId: string, ds: Dataset): RawMetrics {
    const progress = ds.progress.get(key(userId, worldId));
    const stats = ds.stats.get(key(userId, worldId));
    return {
      points: progress?.totalPoints ?? 0,
      attempts: stats?.snapshot.attemptsCount ?? 0,
      correct: stats?.snapshot.correctCount ?? 0,
      incorrect: stats?.snapshot.incorrectCount ?? 0,
      timeouts: stats?.snapshot.timeoutCount ?? 0,
      totalCorrectElapsedMs: stats?.totalCorrectElapsedMs ?? 0,
    };
  }

  private rawForStudent(userId: string, ds: Dataset): RawMetrics {
    return ds.worlds.reduce((acc, w) => addMetrics(acc, this.rawFor(userId, w.id, ds)), emptyMetrics());
  }

  private studentWorld(userId: string, world: LoadedWorld, ds: Dataset): StudentWorldDto {
    const progress = ds.progress.get(key(userId, world.id));
    return {
      worldSlug: world.definition.slug,
      worldName: world.definition.name,
      ...toMetricsDto(this.rawFor(userId, world.id, ds)),
      progressStatus: progress ? progress.status : 'NOT_STARTED',
      currentPosition: progress?.currentPosition ?? null,
      challengeCount: world.definition.sequence.ruleCount.BASELINE + 1,
      challengesCompleted: ds.completed.get(key(userId, world.id)) ?? 0,
      unlockedRulesCount: progress?.unlockedRulesCount ?? 0,
      currentStreak: progress?.streak ?? 0,
      maxStreak: progress?.bestStreak ?? 0,
    };
  }

  private studentOverview(
    student: { id: string; displayName: string; email: string },
    joinedAt: Date,
    ds: Dataset,
  ): StudentOverviewDto {
    const worlds = ds.worlds.map((world) => this.studentWorld(student.id, world, ds));
    return {
      student: { id: student.id, displayName: student.displayName, email: student.email },
      joinedAt,
      totals: {
        ...toMetricsDto(this.rawForStudent(student.id, ds)),
        challengesCompleted: worlds.reduce((sum, w) => sum + w.challengesCompleted, 0),
        lastActivityAt: ds.activity.get(student.id)?.lastAttemptStartedAt ?? null,
      },
      worlds,
    };
  }

  private summarize(memberIds: string[], ds: Dataset): ActivitySummaryDto {
    const totals = memberIds.reduce((acc, id) => addMetrics(acc, this.rawForStudent(id, ds)), emptyMetrics());
    const lastTimes = memberIds.flatMap((id) => {
      const last = ds.activity.get(id)?.lastAttemptStartedAt;
      return last ? [last.getTime()] : [];
    });
    return {
      studentCount: memberIds.length,
      studentsWithActivity: memberIds.filter((id) => (ds.activity.get(id)?.attemptsStarted ?? 0) > 0).length,
      activeStudentsLast7Days: memberIds.filter((id) => (ds.recentActivity.get(id)?.attemptsStarted ?? 0) > 0)
        .length,
      lastActivityAt: lastTimes.length > 0 ? new Date(Math.max(...lastTimes)) : null,
      totals: toMetricsDto(totals),
    };
  }

  private performanceByWorld(memberIds: string[], ds: Dataset): WorldPerformanceDto[] {
    return ds.worlds.map((world) => {
      const raw = memberIds.reduce(
        (acc, id) => addMetrics(acc, this.rawFor(id, world.id, ds)),
        emptyMetrics(),
      );
      const progress = memberIds.flatMap((id) => {
        const p = ds.progress.get(key(id, world.id));
        return p ? [p] : [];
      });
      return {
        worldSlug: world.definition.slug,
        worldName: world.definition.name,
        ...toMetricsDto(raw),
        studentsStarted: progress.length,
        studentsCompleted: progress.filter((p) => p.status === 'COMPLETED').length,
      };
    });
  }

  private commonErrors(
    rows: { worldId: string; reason: string; count: number }[],
    worldById: Map<string, LoadedWorld>,
  ): CommonErrorDto[] {
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.worldId, (totals.get(row.worldId) ?? 0) + row.count);
    return rows
      .flatMap((row) => {
        const world = worldById.get(row.worldId);
        if (!world) return [];
        return [
          {
            worldSlug: world.definition.slug,
            reason: row.reason as CommonErrorDto['reason'],
            count: row.count,
            sharePercent: percent(row.count, totals.get(row.worldId) ?? 0) ?? 0,
          },
        ];
      })
      .sort((a, b) => b.count - a.count);
  }

  /** Incumplimientos por regla, a partir de `WorldStatistics.ruleViolationCounts` (sin recalcular). */
  private violatedRules(userIds: string[], ds: Dataset): ViolatedRuleDto[] {
    const result: ViolatedRuleDto[] = [];
    for (const world of ds.worlds) {
      const byRule = new Map<string, { violations: number; students: number }>();
      for (const userId of userIds) {
        const counts = ds.stats.get(key(userId, world.id))?.snapshot.ruleViolationCounts ?? {};
        for (const [ruleKey, count] of Object.entries(counts)) {
          if (count <= 0) continue;
          const entry = byRule.get(ruleKey) ?? { violations: 0, students: 0 };
          entry.violations += count;
          entry.students += 1;
          byRule.set(ruleKey, entry);
        }
      }
      const rules = new Map(world.definition.rules.map((r) => [r.id, r]));
      for (const [ruleKey, entry] of byRule) {
        const rule = rules.get(ruleKey);
        result.push({
          worldSlug: world.definition.slug,
          ruleKey,
          ruleType: rule?.type ?? null,
          description: rule?.description ?? null,
          violations: entry.violations,
          studentsAffected: entry.students,
        });
      }
    }
    return result;
  }

  /** Dificultad por posición de la secuencia (los retos se generan por secuencia: se agrupan por posición). */
  private challengeDifficulty(rows: ChallengeOutcomeRow[], worlds: LoadedWorld[]): ChallengeDifficultyDto[] {
    const worldById = new Map(worlds.map((world) => [world.id, world]));
    return rows.flatMap((row) => {
      const world = worldById.get(row.worldId);
      if (!world) return [];
      const failures = row.attempts - row.correct;
      return [
        {
          worldSlug: world.definition.slug,
          position: row.position,
          expression: row.sampleExpression,
          attempts: row.attempts,
          correct: row.correct,
          failures,
          failureRatePercent: percent(failures, row.attempts),
        },
      ];
    });
  }

  private emptyChallenge(worldSlug: string, position: number, expression: string): ChallengeDifficultyDto {
    return {
      worldSlug,
      position,
      expression,
      attempts: 0,
      correct: 0,
      failures: 0,
      failureRatePercent: null,
    };
  }
}

/** Retos de la secuencia más larga posible del mundo (dificultad máxima: reglas sorteadas + 1). */
function maxSequenceLength(world: LoadedWorld): number {
  return world.definition.sequence.ruleCount.HARDER + 1;
}
