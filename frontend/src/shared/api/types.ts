/** Contratos de la API (espejo de los DTO de `apps/api`). El frontend solo los muestra: el servidor decide. */

export type UserProfile = {
  id: string
  email: string
  displayName: string
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
}

export type AccessToken = {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export type WorldSummary = {
  slug: string
  name: string
  description: string
  position: number
  challengeCount: number
}

export type Rule = {
  key: string
  type: string
  description: string
}

export type UnlockedRule = Rule & { unlockedAt: string }

export type Session = {
  id: string
  worldSlug: string
  startedAt: string
  endedAt: string | null
}

export type StartSessionResponse = {
  session: Session
  created: boolean
}

export type ChallengeAttempt = {
  attemptId: string
  sessionId: string
  worldSlug: string
  position: number
  challengeCount: number
  expression: string
  rules: Rule[]
  newRule: Rule | null
  timeLimitSeconds: number
  startedAt: string
  deadlineAt: string
  serverTime: string
  remainingMs: number
  resumed: boolean
  expiredAttempt: { attemptId: string; outcome: 'TIMEOUT' } | null
}

export type Violation = {
  ruleKey: string
  ruleType: string
  description: string
  message: string
}

export type WorldStatistics = {
  attemptsCount: number
  correctCount: number
  incorrectCount: number
  timeoutCount: number
  averageCorrectElapsedMs: number | null
  ruleViolationCounts: Record<string, number>
}

export type WorldProgress = {
  worldSlug: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  currentPosition: number
  challengeCount: number
  streak: number
  bestStreak: number
  totalPoints: number
  nextMultiplierMilli: number
  nextMultiplier: string
  unlockedRules: UnlockedRule[]
  activeSessionId: string | null
  pendingAttemptId: string | null
  statistics: WorldStatistics
}

export type Outcome = 'CORRECT' | 'INCORRECT' | 'TIMEOUT'

export type AnswerResult = {
  attemptId: string
  outcome: Outcome
  failureReason: string | null
  message: string
  evaluatedValue: string | null
  violations: Violation[]
  score: { basePoints: number; multiplierMilli: number; multiplier: string; points: number }
  unlockedRule: Rule | null
  sequenceRestarted: boolean
  worldCompleted: boolean
  progress: WorldProgress
  replayed: boolean
}

export type LeaderboardEntry = {
  rank: number
  displayName: string
  points: number
  isCurrentUser: boolean
}

export type Leaderboard = {
  worldSlug: string
  scope: 'GROUPS' | 'SELF'
  participants: number
  entries: LeaderboardEntry[]
  me: LeaderboardEntry
}

// ── Panel docente ──────────────────────────────────────────────────────────

/** Contadores sin actividad = 0; promedios y porcentajes sin denominador = `null` ("no disponible"). */
export type Metrics = {
  points: number
  attempts: number
  correct: number
  incorrect: number
  timeouts: number
  accuracyPercent: number | null
  averageCorrectResponseTimeMs: number | null
}

export type TeacherGroup = {
  id: string
  name: string
  description: string | null
  status: 'ACTIVE' | 'INACTIVE'
  activeStudentCount: number
  activeTeacherCount: number
}

export type TeacherDashboard = {
  generatedAt: string
  groups: {
    group: TeacherGroup
    activity: {
      studentCount: number
      studentsWithActivity: number
      activeStudentsLast7Days: number
      lastActivityAt: string | null
      totals: Metrics
    }
  }[]
}

export type FailureReason =
  | 'SYNTAX_ERROR'
  | 'DIVISION_BY_ZERO'
  | 'WRONG_RESULT'
  | 'CLAIMED_RESULT_MISMATCH'
  | 'RULE_VIOLATION'
  | 'TIMEOUT'

export type CommonError = { worldSlug: string; reason: FailureReason; count: number; sharePercent: number }

export type ViolatedRule = {
  worldSlug: string
  ruleKey: string
  ruleType: string | null
  description: string | null
  violations: number
  studentsAffected: number
}

export type ChallengeDifficulty = {
  worldSlug: string
  position: number
  expression: string
  attempts: number
  correct: number
  failures: number
  failureRatePercent: number | null
}

export type StudentAttention = {
  student: { id: string; displayName: string }
  reasons: ('LOW_ACCURACY' | 'REPEATED_FAILURES')[]
  attempts: number
  accuracyPercent: number | null
  consecutiveFailures: number
}

export type GroupStatistics = {
  generatedAt: string
  studentCount: number
  commonErrors: CommonError[]
  frequentlyViolatedRules: ViolatedRule[]
  challengesNeedingReinforcement: ChallengeDifficulty[]
  studentsNeedingAttention: StudentAttention[]
}

export type StudentOverview = {
  student: { id: string; displayName: string; email: string }
  joinedAt: string
  totals: Metrics & { challengesCompleted: number; lastActivityAt: string | null }
}

export type StudentOverviewPage = { items: StudentOverview[]; nextCursor: string | null }

export type StudentStatistics = {
  generatedAt: string
  student: { id: string; displayName: string }
  worlds: {
    worldSlug: string
    worldName: string
    consecutiveFailures: number
    commonErrors: CommonError[]
    violatedRules: ViolatedRule[]
    challenges: ChallengeDifficulty[]
  }[]
}

export type StudentAttempt = {
  attemptId: string
  worldSlug: string
  position: number
  expression: string
  outcome: 'PENDING' | 'CORRECT' | 'INCORRECT' | 'TIMEOUT'
  startedAt: string
}

export type StudentAttemptPage = { items: StudentAttempt[]; nextCursor: string | null }
