import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes } from '@/app/router/AppRoutes';
import { API_URL } from '@/services/api/client';
import type {
  AnswerResult,
  AttemptHistoryItem,
  ChallengeAttempt,
  Rule,
  ScoreSummary,
  UserProfile,
  WorldProgress,
  WorldSummary,
} from '@/services/api/types';

// ───────────── Fixtures (la forma de cada respuesta de la API) ─────────────

export const TOKEN_KEY = 'eureka.token';

export const student: UserProfile = {
  id: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
  role: 'STUDENT',
};
export const teacher: UserProfile = {
  id: 't1',
  email: 'profe@example.com',
  displayName: 'Profa',
  role: 'TEACHER',
};

export const rule2: Rule = { key: 'r2', type: 'FORBIDDEN_DIGIT', description: 'No puedes usar el dígito 2.' };
export const rule7x1: Rule = {
  key: 'r7',
  type: 'REQUIRED_OPERATION',
  description: 'Debes usar la multiplicación 7 * 1.',
};

export const rule5: Rule = { key: 'r5', type: 'FORBIDDEN_DIGIT', description: 'No puedes usar el dígito 5.' };

const integers = { decimals: false, powers: false };

export const arithmeticWorld: WorldSummary = {
  slug: 'arithmetic',
  name: 'Aritmética',
  description: 'Suma, resta, multiplicación y división bajo reglas.',
  position: 1,
  challengeCount: 4,
  ruleCount: 6,
  concepts: ['Cuatro operaciones', 'Jerarquía de operaciones'],
  syntax: integers,
};
export const signsWorld: WorldSummary = {
  slug: 'signs',
  name: 'Números y signos',
  description: 'Positivos, negativos y la regla de los signos.',
  position: 2,
  challengeCount: 4,
  ruleCount: 6,
  concepts: ['Negativos', 'Regla de los signos'],
  syntax: integers,
};
export const fractionsWorld: WorldSummary = {
  slug: 'fractions',
  name: 'Fracciones y decimales',
  description: 'Partes de la unidad y decimales exactos.',
  position: 3,
  challengeCount: 4,
  ruleCount: 6,
  concepts: ['Fracciones', 'Decimales exactos'],
  syntax: { decimals: true, powers: false },
};
export const algebraWorld: WorldSummary = {
  slug: 'algebra',
  name: 'Álgebra',
  description: 'Ecuaciones lineales y potencias.',
  position: 4,
  challengeCount: 4,
  ruleCount: 6,
  concepts: ['Ecuaciones lineales', 'Potencias'],
  syntax: { decimals: false, powers: true },
};
export const chaosWorld: WorldSummary = {
  slug: 'chaos',
  name: 'Caos matemático',
  description: 'Todo lo anterior, mezclado.',
  position: 5,
  challengeCount: 5,
  ruleCount: 8,
  concepts: ['Todo combinado'],
  syntax: { decimals: true, powers: true },
};
/** Los cinco mundos, desordenados a propósito: la app los ordena por `position`. */
export const allWorlds: WorldSummary[] = [
  signsWorld,
  arithmeticWorld,
  chaosWorld,
  fractionsWorld,
  algebraWorld,
];

export function progress(over: Partial<WorldProgress> = {}): WorldProgress {
  return {
    worldSlug: 'arithmetic',
    status: 'IN_PROGRESS',
    unlocked: true,
    unlockRequirement: null,
    completionsCount: 0,
    firstCompletedAt: null,
    ruleCount: 6,
    currentPosition: 1,
    challengeCount: 4,
    activeSequence: null,
    streak: 0,
    bestStreak: 0,
    totalPoints: 0,
    nextMultiplierMilli: 1000,
    nextMultiplier: '1',
    unlockedRules: [],
    activeSessionId: null,
    pendingAttemptId: null,
    statistics: {
      attemptsCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      timeoutCount: 0,
      averageCorrectElapsedMs: null,
      ruleViolationCounts: {},
    },
    ...over,
  };
}

/** Progreso de un mundo bloqueado hasta completar `required`. */
export function lockedProgress(world: WorldSummary, required: WorldSummary): WorldProgress {
  return progress({
    worldSlug: world.slug,
    unlocked: false,
    unlockRequirement: { worldSlug: required.slug, worldName: required.name, position: required.position },
    ruleCount: world.ruleCount,
  });
}

/** Progreso de los cinco mundos: Mundo 1 con `first`; el resto bloqueados en cadena. */
export function worldsProgress(first: Partial<WorldProgress> = {}): WorldProgress[] {
  const ordered = [arithmeticWorld, signsWorld, fractionsWorld, algebraWorld, chaosWorld];
  return [progress(first), ...ordered.slice(1).map((world, index) => lockedProgress(world, ordered[index]))];
}

export function attempt(over: Partial<ChallengeAttempt> = {}): ChallengeAttempt {
  return {
    attemptId: 'a1',
    sessionId: 's1',
    worldSlug: 'arithmetic',
    sequenceId: 'q1',
    difficulty: 'BASELINE',
    position: 1,
    challengeCount: 4,
    statementKind: 'EXPRESSION',
    expression: '3 * 7',
    instruction: 'Escribe una expresión con el mismo resultado que cumpla todas las reglas activas.',
    syntax: integers,
    rules: [],
    newRule: null,
    timeLimitSeconds: 60,
    startedAt: '2026-11-21T10:00:00.000Z',
    deadlineAt: '2026-11-21T10:01:00.000Z',
    serverTime: '2026-11-21T10:00:00.000Z',
    remainingMs: 60_000,
    resumed: false,
    expiredAttempt: null,
    ...over,
  };
}

export function answer(over: Partial<AnswerResult> = {}): AnswerResult {
  return {
    attemptId: 'a1',
    outcome: 'CORRECT',
    failureReason: null,
    message: '¡Correcto!',
    evaluatedValue: '21',
    violations: [],
    score: { basePoints: 100, multiplierMilli: 1000, multiplier: '1', points: 100 },
    unlockedRule: null,
    sequenceRestarted: false,
    discardedRules: [],
    worldCompleted: false,
    nextWorldUnlocked: null,
    progress: progress({ totalPoints: 100, streak: 1, nextMultiplierMilli: 1500, nextMultiplier: '1.5' }),
    replayed: false,
    ...over,
  };
}

export function historyItem(over: Partial<AttemptHistoryItem> = {}): AttemptHistoryItem {
  return {
    attemptId: 'h1',
    position: 1,
    expression: '3 * 7',
    outcome: 'CORRECT',
    failureReason: null,
    submission: '7 * 1 * 3',
    evaluatedValue: '21',
    activeRuleKeys: [],
    timeLimitSeconds: 60,
    startedAt: '2026-11-21T10:00:00.000Z',
    submittedAt: '2026-11-21T10:00:05.000Z',
    elapsedMs: 5_000,
    streakBefore: 0,
    pointsAwarded: 100,
    ...over,
  };
}

export function scoreSummary(over: Partial<ScoreSummary> = {}): ScoreSummary {
  return {
    worldSlug: 'arithmetic',
    totalPoints: 0,
    streak: 0,
    bestStreak: 0,
    nextMultiplierMilli: 1000,
    nextMultiplier: '1',
    recentTransactions: [],
    ...over,
  };
}

// ───────────── API simulada ─────────────

export type MockResponse = { status?: number; body?: unknown; headers?: Record<string, string> };
export type Handler = (body: unknown) => MockResponse;

/** Respuestas sucesivas para una misma ruta; la última se repite. */
export function sequence(...responses: MockResponse[]): Handler {
  let index = 0;
  return () => responses[Math.min(index++, responses.length - 1)];
}

export type ApiCall = { key: string; body: unknown };

/**
 * Sustituye `fetch` por una API simulada: clave "MÉTODO /ruta" → respuesta. Una ruta sin simular responde 599
 * (con el nombre de la ruta en el mensaje) para que un test no pase por casualidad con una llamada inesperada.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.slice(API_URL.length);
    const key = `${init?.method ?? 'GET'} ${path}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = handlers[key];
    const reply: MockResponse = handler
      ? handler(body)
      : { status: 599, body: { message: `sin simular: ${key}` } };
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    return Promise.resolve(
      new Response(text === '' ? null : text, {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json', ...reply.headers },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    calls,
    /** Veces que se llamó a una ruta. */
    count: (key: string) => calls.filter((call) => call.key === key).length,
    /** Cuerpos enviados a una ruta. */
    bodies: (key: string) => calls.filter((call) => call.key === key).map((call) => call.body),
    /** Cabecera `Authorization` de la última llamada a `fetch`. */
    lastAuthorization: () =>
      (fetchMock.mock.calls.at(-1)?.[1]?.headers as Record<string, string> | undefined)?.Authorization,
  };
}

export const ok = (body: unknown): MockResponse => ({ body });

// ───────────── Render ─────────────

function LocationProbe() {
  const { pathname } = useLocation();
  // Un <div>, no un <output>: este último tiene rol "status" y se confundiría con los avisos reales de la página.
  return <div data-testid="location">{pathname}</div>;
}

/** Monta la aplicación real (rutas + autenticación) en `path`; `data-testid="location"` muestra la ruta actual. */
export function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Deja una sesión guardada, como tras iniciar sesión en una visita anterior. */
export function signIn(token = 'tok') {
  localStorage.setItem(TOKEN_KEY, token);
}
