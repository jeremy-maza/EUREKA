import {
  ChallengeDifficultyProfile,
  DifficultyLevelName,
  IntegerRange,
  TemplateComplexity,
  WeightedFamily,
} from './generation.types';

/**
 * Perfil del generador para un nivel de dificultad de un mundo. La dificultad CRECE dentro de la secuencia:
 * el reto 1 usa `first`, el último usa `last` y los intermedios interpolan (rangos linealmente, complejidad
 * por escalones, opciones booleanas a partir de la mitad de la secuencia). `families` se sortea con pesos
 * en cada candidato.
 */
export interface WorldLevelProfile {
  families: readonly WeightedFamily[];
  first: ChallengeDifficultyProfile;
  last: ChallengeDifficultyProfile;
}

/** Configuración del generador para un mundo: un perfil por nivel (EASIER < BASELINE < HARDER). */
export interface WorldGenerationConfig {
  profiles: Readonly<Record<DifficultyLevelName, WorldLevelProfile>>;
}

const COMPLEXITY_ORDER: readonly TemplateComplexity[] = ['PRODUCT', 'MIXED', 'NESTED'];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpRange(first: IntegerRange, last: IntegerRange, t: number): IntegerRange {
  const min = lerp(first.min, last.min, t);
  const max = Math.max(min, lerp(first.max, last.max, t));
  return { min, max };
}

/**
 * Perfil concreto del reto en `position` (1-based) de una secuencia de `length` retos. Es una función pura;
 * con `length = 1` devuelve `last`.
 */
export function profileForPosition(
  level: WorldLevelProfile,
  position: number,
  length: number,
): ChallengeDifficultyProfile {
  const t = length <= 1 ? 1 : Math.min(1, Math.max(0, (position - 1) / (length - 1)));
  const { first, last } = level;
  const complexityIndex = lerp(
    COMPLEXITY_ORDER.indexOf(first.complexity),
    COMPLEXITY_ORDER.indexOf(last.complexity),
    t,
  );
  const late = t >= 0.5;
  const profile: ChallengeDifficultyProfile = {
    operandRange: lerpRange(first.operandRange, last.operandRange, t),
    operandCount: lerpRange(first.operandCount, last.operandCount, t),
    complexity: COMPLEXITY_ORDER[complexityIndex],
    allowFractions: late ? last.allowFractions : first.allowFractions,
    allowNegative: late ? last.allowNegative : first.allowNegative,
  };
  const maxResult =
    first.maxResult !== undefined && last.maxResult !== undefined
      ? lerp(first.maxResult, last.maxResult, t)
      : late
        ? last.maxResult
        : first.maxResult;
  return maxResult === undefined ? profile : { ...profile, maxResult };
}
