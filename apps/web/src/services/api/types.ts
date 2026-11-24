/** Contratos de la API (espejo de los DTO de `apps/api`). El frontend solo los muestra: el servidor decide. */

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
};

export type AccessToken = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};

/** Símbolos que admite el parser del servidor en un mundo (además de enteros y `+ - * / ( ) =`). */
export type MathSyntax = { decimals: boolean; powers: boolean };

/** Nivel de dificultad que el servidor elige al empezar cada secuencia. */
export type DifficultyLevel = 'EASIER' | 'BASELINE' | 'HARDER';

/** Referencia breve a un mundo (desbloqueos y requisitos). */
export type WorldRef = { slug: string; name: string; position: number };

export type WorldSummary = {
  slug: string;
  name: string;
  description: string;
  position: number;
  /** Retos de una secuencia BASELINE (la longitud real de cada secuencia varía). */
  challengeCount: number;
  /** Tamaño del repertorio de reglas del mundo. */
  ruleCount: number;
  concepts: string[];
  syntax: MathSyntax;
};

export type Rule = {
  key: string;
  type: string;
  description: string;
};

export type UnlockedRule = Rule & { unlockedAt: string };

export type Session = {
  id: string;
  worldSlug: string;
  startedAt: string;
  endedAt: string | null;
};

export type StartSessionResponse = {
  session: Session;
  created: boolean;
  /** Reto que venció mientras el jugador estaba ausente y que el servidor cerró como TIMEOUT al entrar. */
  expiredAttempt: { attemptId: string; outcome: 'TIMEOUT' } | null;
};

export type StatementKind = 'EXPRESSION' | 'EQUATION';

export type ChallengeAttempt = {
  attemptId: string;
  sessionId: string;
  worldSlug: string;
  sequenceId: string;
  difficulty: DifficultyLevel;
  position: number;
  /** Longitud de ESTA secuencia. */
  challengeCount: number;
  /** `EQUATION`: `expression` es una ecuación en x y la respuesta es una expresión que valga x. */
  statementKind: StatementKind;
  expression: string;
  /** Texto del servidor que se muestra encima de la respuesta. */
  instruction: string;
  syntax: MathSyntax;
  /** Reglas activas de esta secuencia (las ya superadas en ella + la nueva). */
  rules: Rule[];
  newRule: Rule | null;
  timeLimitSeconds: number;
  startedAt: string;
  deadlineAt: string;
  serverTime: string;
  remainingMs: number;
  resumed: boolean;
  expiredAttempt: { attemptId: string; outcome: 'TIMEOUT' } | null;
};

export type Violation = {
  ruleKey: string;
  ruleType: string;
  description: string;
  message: string;
};

export type WorldStatistics = {
  attemptsCount: number;
  correctCount: number;
  incorrectCount: number;
  timeoutCount: number;
  averageCorrectElapsedMs: number | null;
  ruleViolationCounts: Record<string, number>;
};

export type ActiveSequence = {
  id: string;
  difficulty: DifficultyLevel;
  challengeCount: number;
  /** Reglas activas ya superadas en esta secuencia. */
  rules: Rule[];
};

export type WorldProgress = {
  worldSlug: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  unlocked: boolean;
  /** Mundo que hay que completar para desbloquear este; `null` si ya está desbloqueado. */
  unlockRequirement: { worldSlug: string; worldName: string; position: number } | null;
  completionsCount: number;
  firstCompletedAt: string | null;
  /** Tamaño del repertorio de reglas del mundo. */
  ruleCount: number;
  currentPosition: number;
  /** Retos de la secuencia activa (o de una BASELINE si no hay ninguna). */
  challengeCount: number;
  activeSequence: ActiveSequence | null;
  streak: number;
  bestStreak: number;
  totalPoints: number;
  nextMultiplierMilli: number;
  nextMultiplier: string;
  /** Reglas DOMINADAS: superadas alguna vez en este mundo. Es una colección permanente, no las reglas activas. */
  unlockedRules: UnlockedRule[];
  activeSessionId: string | null;
  pendingAttemptId: string | null;
  statistics: WorldStatistics;
};

export type Outcome = 'CORRECT' | 'INCORRECT' | 'TIMEOUT';

export type AnswerResult = {
  attemptId: string;
  outcome: Outcome;
  failureReason: string | null;
  message: string;
  evaluatedValue: string | null;
  violations: Violation[];
  score: { basePoints: number; multiplierMilli: number; multiplier: string; points: number };
  unlockedRule: Rule | null;
  sequenceRestarted: boolean;
  /** Reglas de la secuencia que descarta un fallo (`[]` si acierto). */
  discardedRules: Rule[];
  worldCompleted: boolean;
  /** Mundo que este acierto desbloqueó por primera vez. */
  nextWorldUnlocked: WorldRef | null;
  progress: WorldProgress;
  replayed: boolean;
};

/** Un intento del historial del jugador (`GET /worlds/:slug/attempts`). */
export type AttemptHistoryItem = {
  attemptId: string;
  position: number;
  expression: string;
  outcome: 'PENDING' | Outcome;
  failureReason: string | null;
  submission: string | null;
  evaluatedValue: string | null;
  activeRuleKeys: string[];
  timeLimitSeconds: number;
  startedAt: string;
  submittedAt: string | null;
  elapsedMs: number | null;
  streakBefore: number;
  pointsAwarded: number;
};

export type AttemptHistoryPage = { items: AttemptHistoryItem[]; nextCursor: string | null };

/** Una anotación del libro de puntos (`GET /worlds/:slug/score`). */
export type ScoreTransaction = {
  id: string;
  attemptId: string | null;
  reason: 'CORRECT_ANSWER' | 'MANUAL_ADJUSTMENT';
  basePoints: number;
  multiplierMilli: number;
  multiplier: string;
  points: number;
  streakAfter: number;
  createdAt: string;
};

export type ScoreSummary = {
  worldSlug: string;
  totalPoints: number;
  streak: number;
  bestStreak: number;
  nextMultiplierMilli: number;
  nextMultiplier: string;
  recentTransactions: ScoreTransaction[];
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  points: number;
  isCurrentUser: boolean;
};

export type Leaderboard = {
  worldSlug: string;
  scope: 'GROUPS' | 'SELF';
  participants: number;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry;
};

// ── Panel docente ──────────────────────────────────────────────────────────

/** Contadores sin actividad = 0; promedios y porcentajes sin denominador = `null` ("no disponible"). */
export type Metrics = {
  points: number;
  attempts: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  accuracyPercent: number | null;
  averageCorrectResponseTimeMs: number | null;
};

export type TeacherGroup = {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  activeStudentCount: number;
  activeTeacherCount: number;
};

export type TeacherDashboard = {
  generatedAt: string;
  groups: {
    group: TeacherGroup;
    activity: {
      studentCount: number;
      studentsWithActivity: number;
      activeStudentsLast7Days: number;
      lastActivityAt: string | null;
      totals: Metrics;
    };
  }[];
};

export type FailureReason =
  | 'SYNTAX_ERROR'
  | 'DIVISION_BY_ZERO'
  | 'WRONG_RESULT'
  | 'CLAIMED_RESULT_MISMATCH'
  | 'RULE_VIOLATION'
  | 'TIMEOUT';

export type CommonError = { worldSlug: string; reason: FailureReason; count: number; sharePercent: number };

export type ViolatedRule = {
  worldSlug: string;
  ruleKey: string;
  ruleType: string | null;
  description: string | null;
  violations: number;
  studentsAffected: number;
};

export type ChallengeDifficulty = {
  worldSlug: string;
  position: number;
  expression: string;
  attempts: number;
  correct: number;
  failures: number;
  failureRatePercent: number | null;
};

export type StudentAttention = {
  student: { id: string; displayName: string };
  reasons: ('LOW_ACCURACY' | 'REPEATED_FAILURES')[];
  attempts: number;
  accuracyPercent: number | null;
  consecutiveFailures: number;
};

export type GroupStatistics = {
  generatedAt: string;
  studentCount: number;
  commonErrors: CommonError[];
  frequentlyViolatedRules: ViolatedRule[];
  challengesNeedingReinforcement: ChallengeDifficulty[];
  studentsNeedingAttention: StudentAttention[];
};

export type StudentOverview = {
  student: { id: string; displayName: string; email: string };
  joinedAt: string;
  totals: Metrics & { challengesCompleted: number; lastActivityAt: string | null };
};

export type StudentOverviewPage = { items: StudentOverview[]; nextCursor: string | null };

export type StudentStatistics = {
  generatedAt: string;
  student: { id: string; displayName: string };
  worlds: {
    worldSlug: string;
    worldName: string;
    consecutiveFailures: number;
    commonErrors: CommonError[];
    violatedRules: ViolatedRule[];
    challenges: ChallengeDifficulty[];
  }[];
};

export type StudentAttempt = {
  attemptId: string;
  worldSlug: string;
  position: number;
  expression: string;
  outcome: 'PENDING' | 'CORRECT' | 'INCORRECT' | 'TIMEOUT';
  startedAt: string;
};

export type StudentAttemptPage = { items: StudentAttempt[]; nextCursor: string | null };
