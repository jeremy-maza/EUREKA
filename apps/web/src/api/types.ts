/** Contratos de la API (espejo de los DTO de `apps/api`). El frontend solo los muestra: el servidor decide. */

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

export interface AccessToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface Rule {
  key: string;
  type: string;
  description: string;
}

export interface UnlockedRule extends Rule {
  unlockedAt: string;
}

export interface Session {
  id: string;
  worldSlug: string;
  startedAt: string;
  endedAt: string | null;
}

export interface StartSessionResponse {
  session: Session;
  created: boolean;
}

export interface ChallengeAttempt {
  attemptId: string;
  sessionId: string;
  worldSlug: string;
  position: number;
  challengeCount: number;
  expression: string;
  rules: Rule[];
  newRule: Rule | null;
  timeLimitSeconds: number;
  startedAt: string;
  deadlineAt: string;
  serverTime: string;
  remainingMs: number;
  resumed: boolean;
  expiredAttempt: { attemptId: string; outcome: 'TIMEOUT' } | null;
}

export interface Violation {
  ruleKey: string;
  ruleType: string;
  description: string;
  message: string;
}

export interface WorldStatistics {
  attemptsCount: number;
  correctCount: number;
  incorrectCount: number;
  timeoutCount: number;
  averageCorrectElapsedMs: number | null;
  ruleViolationCounts: Record<string, number>;
}

export interface WorldProgress {
  worldSlug: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  currentPosition: number;
  challengeCount: number;
  streak: number;
  bestStreak: number;
  totalPoints: number;
  nextMultiplierMilli: number;
  nextMultiplier: string;
  unlockedRules: UnlockedRule[];
  activeSessionId: string | null;
  pendingAttemptId: string | null;
  statistics: WorldStatistics;
}

export type Outcome = 'CORRECT' | 'INCORRECT' | 'TIMEOUT';

export interface AnswerResult {
  attemptId: string;
  outcome: Outcome;
  failureReason: string | null;
  message: string;
  evaluatedValue: string | null;
  violations: Violation[];
  score: { basePoints: number; multiplierMilli: number; multiplier: string; points: number };
  unlockedRule: Rule | null;
  sequenceRestarted: boolean;
  worldCompleted: boolean;
  progress: WorldProgress;
  replayed: boolean;
}

export interface AttemptHistoryItem {
  attemptId: string;
  position: number;
  expression: string;
  outcome: 'PENDING' | Outcome;
  failureReason: string | null;
  submission: string | null;
  evaluatedValue: string | null;
  startedAt: string;
  elapsedMs: number | null;
  streakBefore: number;
  pointsAwarded: number;
}

export interface AttemptHistoryPage {
  items: AttemptHistoryItem[];
  nextCursor: string | null;
}

export interface ScoreTransaction {
  id: string;
  attemptId: string | null;
  reason: string;
  basePoints: number;
  multiplier: string;
  points: number;
  streakAfter: number;
  createdAt: string;
}

export interface ScoreSummary {
  worldSlug: string;
  totalPoints: number;
  streak: number;
  bestStreak: number;
  nextMultiplier: string;
  recentTransactions: ScoreTransaction[];
}
