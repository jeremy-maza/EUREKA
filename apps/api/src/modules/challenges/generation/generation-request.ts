import { DEFAULT_MATH_SYNTAX, DEFAULT_MAX_EXPRESSION_LENGTH, MathSyntax } from '../math';
import { RuleDefinition } from '../rules';
import {
  ChallengeDifficultyProfile,
  ChallengeGenerationRequest,
  DEFAULT_DIFFICULTY_PROFILE,
  DEFAULT_GENERATION_LIMITS,
  GenerationLimits,
  IntegerRange,
  STATEMENT_FAMILIES,
  StatementFamily,
  WeightedFamily,
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
  /** `null` = comportamiento original (solo la familia multiplicativa, mismo consumo del RNG). */
  families: readonly WeightedFamily[] | null;
  syntax: MathSyntax;
}

/** Sintaxis que necesita cada familia para escribir sus enunciados. */
export function familyRequirementProblem(family: StatementFamily, syntax: MathSyntax): string | null {
  if (family === 'DECIMAL' && !syntax.decimals)
    return 'La familia DECIMAL requiere una sintaxis con decimales.';
  if (family === 'POWER' && !syntax.powers) return 'La familia POWER requiere una sintaxis con potencias.';
  return null;
}

export const MAX_FAMILY_WEIGHT = 100;

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
  if (typeof profile.allowNegative !== 'boolean') problems.push('"profile.allowNegative" debe ser booleano.');
  if (profile.maxResult !== undefined)
    validateInt('profile.maxResult', profile.maxResult, 1, 1_000_000_000, problems);

  const syntax: MathSyntax = request.syntax ?? DEFAULT_MATH_SYNTAX;
  if (
    typeof syntax !== 'object' ||
    typeof syntax.decimals !== 'boolean' ||
    typeof syntax.powers !== 'boolean'
  ) {
    problems.push('"syntax" debe tener "decimals" y "powers" booleanos.');
  }

  let families: readonly WeightedFamily[] | null = null;
  if (request.families !== undefined) {
    if (!Array.isArray(request.families) || request.families.length === 0) {
      problems.push('"families" debe ser una lista no vacía.');
    } else {
      families = request.families;
      const seen = new Set<string>();
      for (const entry of request.families) {
        if (!STATEMENT_FAMILIES.includes(entry?.family)) {
          problems.push(`Familia de enunciados desconocida: "${String(entry?.family)}".`);
          continue;
        }
        if (seen.has(entry.family)) problems.push(`Familia repetida: "${entry.family}".`);
        seen.add(entry.family);
        validateInt(`families.${entry.family}.weight`, entry.weight, 1, MAX_FAMILY_WEIGHT, problems);
        const requirement =
          typeof syntax === 'object' ? familyRequirementProblem(entry.family, syntax) : null;
        if (requirement !== null) problems.push(requirement);
      }
    }
  }

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
      families,
      syntax,
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
