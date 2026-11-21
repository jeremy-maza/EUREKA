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
