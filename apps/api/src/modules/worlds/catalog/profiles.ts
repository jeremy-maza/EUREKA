import { ChallengeDifficultyProfile, IntegerRange, TemplateComplexity } from '../../challenges';

/** Atajo para escribir perfiles de catálogo de forma compacta y legible. */
export function profile(
  operandRange: [number, number],
  operandCount: [number, number],
  complexity: TemplateComplexity,
  options: { fractions?: boolean; negatives?: boolean; maxResult?: number } = {},
): ChallengeDifficultyProfile {
  const range = (pair: [number, number]): IntegerRange => ({ min: pair[0], max: pair[1] });
  return {
    operandRange: range(operandRange),
    operandCount: range(operandCount),
    complexity,
    allowFractions: options.fractions ?? false,
    allowNegative: options.negatives ?? false,
    ...(options.maxResult === undefined ? {} : { maxResult: options.maxResult }),
  };
}
