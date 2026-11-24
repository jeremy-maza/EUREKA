import { DEFAULT_MAX_EXPRESSION_LENGTH } from '../math';
import { RuleDefinition } from '../rules';
import {
  ChallengeDifficultyProfile,
  ChallengeGenerationRequest,
  DEFAULT_DIFFICULTY_PROFILE,
  DEFAULT_GENERATION_LIMITS,
  GenerationLimits,
  IntegerRange,
} from './generation.types';

export interface ResolvedGenerationRequest {
  position: number;
  rules: readonly RuleDefinition[];
  introducesRuleId: string | null;
  seed: number;
  profile: ChallengeDifficultyProfile;
  limits: GenerationLimits;
  avoid: ReadonlySet<string>;
  challengeId: string | null;
}

export const MAX_OPERAND_VALUE = 9999;
export const MAX_OPERAND_COUNT = 8;
export const MAX_CANDIDATES_CAP = 10_000;
export const MAX_WITNESS_ATTEMPTS_CAP = 50;

const COMPLEXITIES = ['PRODUCT', 'MIXED', 'NESTED'];

/**
 * Aplica valores por defecto y valida la petición completa. Devuelve TODOS los problemas a la vez;
 * nunca lanza por datos de entrada malos.
 */
export function resolveGenerationRequest(
  request: ChallengeGenerationRequest,
): { ok: true; value: ResolvedGenerationRequest } | { ok: false; problems: string[] } {
  const problems: string[] = [];

  if (!Number.isSafeInteger(request.position) || request.position < 1) {
    problems.push('"position" debe ser un entero ≥ 1.');
  }
  if (!Number.isSafeInteger(request.seed)) problems.push('"seed" debe ser un entero seguro.');

  const rules = Array.isArray(request.activeRules)
    ? (request.activeRules as readonly RuleDefinition[])
    : null;
  if (rules === null) {
    problems.push('"activeRules" debe ser una lista.');
  } else {
    const ids = new Set<string>();
    for (const rule of rules) {
      if (ids.has(rule.id)) problems.push(`Regla activa duplicada: "${rule.id}".`);
      ids.add(rule.id);
    }
    const introduced = request.introducesRuleId ?? null;
    if (introduced !== null && !ids.has(introduced)) {
      problems.push(`"introducesRuleId" ("${introduced}") no está entre las reglas activas.`);
    }
  }

  const profile: ChallengeDifficultyProfile = { ...DEFAULT_DIFFICULTY_PROFILE, ...request.profile };
  validateRange('profile.operandRange', profile.operandRange, 1, MAX_OPERAND_VALUE, problems);
  validateRange('profile.operandCount', profile.operandCount, 2, MAX_OPERAND_COUNT, problems);
  if (!COMPLEXITIES.includes(profile.complexity)) {
    problems.push(`"profile.complexity" debe ser uno de ${COMPLEXITIES.join(', ')}.`);
  }
  if (typeof profile.allowFractions !== 'boolean')
    problems.push('"profile.allowFractions" debe ser booleano.');

  const limits: GenerationLimits = { ...DEFAULT_GENERATION_LIMITS, ...request.limits };
  validateInt('limits.maxCandidates', limits.maxCandidates, 1, MAX_CANDIDATES_CAP, problems);
  validateInt(
    'limits.maxWitnessAttemptsPerCandidate',
    limits.maxWitnessAttemptsPerCandidate,
    1,
    MAX_WITNESS_ATTEMPTS_CAP,
    problems,
  );
  validateInt(
    'limits.maxExpressionLength',
    limits.maxExpressionLength,
    1,
    DEFAULT_MAX_EXPRESSION_LENGTH,
    problems,
  );

  const avoid = new Set<string>();
  if (request.avoidFingerprints !== undefined) {
    for (const fingerprint of request.avoidFingerprints) {
      if (typeof fingerprint === 'string') avoid.add(fingerprint);
      else problems.push('"avoidFingerprints" solo admite cadenas.');
    }
  }

  if (request.challengeId !== undefined && request.challengeId.trim().length === 0) {
    problems.push('"challengeId" no puede estar vacío.');
  }

  if (problems.length > 0 || rules === null) return { ok: false, problems };
  return {
    ok: true,
    value: {
      position: request.position,
      rules,
      introducesRuleId: request.introducesRuleId ?? null,
      seed: request.seed,
      profile,
      limits,
      avoid,
      challengeId: request.challengeId ?? null,
    },
  };
}

function validateInt(name: string, value: unknown, min: number, max: number, problems: string[]): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    problems.push(`"${name}" debe ser un entero entre ${min} y ${max}.`);
  }
}

function validateRange(
  name: string,
  range: IntegerRange,
  min: number,
  max: number,
  problems: string[],
): void {
  if (
    typeof range !== 'object' ||
    range === null ||
    !Number.isSafeInteger(range.min) ||
    !Number.isSafeInteger(range.max) ||
    range.min < min ||
    range.max > max ||
    range.min > range.max
  ) {
    problems.push(`"${name}" debe cumplir ${min} ≤ min ≤ max ≤ ${max}.`);
  }
}
