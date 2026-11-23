import { ChallengeDefinition, SolvabilityReport, SubmissionEvaluation } from './challenge.types';
import {
  DEFAULT_MATH_SYNTAX,
  DivisionByZeroError,
  ExpressionParser,
  ExpressionSyntaxError,
  Fraction,
  InvalidPowerError,
  MathEvaluator,
  MathSyntax,
  ParsedAnswer,
  solveLinearEquation,
} from './math';
import { RuleDefinition, RuleEngine, RuleViolation, createDefaultRuleEngine } from './rules';

export interface ChallengeEngineDependencies {
  parser: ExpressionParser;
  evaluator: MathEvaluator;
  ruleEngine: RuleEngine;
}

export interface EvaluateSubmissionInput {
  challenge: ChallengeDefinition;
  /** Reglas activas: las acumuladas por el jugador + la del reto actual. */
  activeRules: readonly RuleDefinition[];
  submission: string;
  /** Sintaxis del mundo (decimales, potencias). Por defecto la del Mundo 1. */
  syntax?: MathSyntax;
}

export function isEquation(challenge: Pick<ChallengeDefinition, 'statementKind'>): boolean {
  return challenge.statementKind === 'EQUATION';
}

/**
 * Evalúa una respuesta frente a un reto. Mantiene separadas las dos responsabilidades:
 *   1. Matemática: parsear + evaluar (MathEvaluator) con la sintaxis del mundo.
 *   2. Reglas: validar el AST contra las reglas activas (RuleEngine).
 * Es puro: no depende de HTTP, base de datos ni reloj (el tiempo lo gestiona `TimerManager`).
 *
 * Errores matemáticos del jugador → motivo de fallo (los valores los usa la BD, no se añaden nuevos):
 *   sintaxis y potencias no evaluables (`InvalidPowerError`) → `SYNTAX_ERROR`; división entre cero →
 *   `DIVISION_BY_ZERO`.
 */
export class ChallengeEngine {
  constructor(private readonly deps: ChallengeEngineDependencies) {}

  evaluateSubmission({
    challenge,
    activeRules,
    submission,
    syntax = DEFAULT_MATH_SYNTAX,
  }: EvaluateSubmissionInput): SubmissionEvaluation {
    const { parser, evaluator, ruleEngine } = this.deps;
    const equation = isEquation(challenge);

    let parsed: ParsedAnswer;
    try {
      parsed = parser.parseAnswer(submission, syntax, { equation });
    } catch (error) {
      if (error instanceof ExpressionSyntaxError) {
        return failure('SYNTAX_ERROR', error.message);
      }
      throw error;
    }

    let value: Fraction;
    try {
      value = evaluator.evaluate(parsed.expression);
    } catch (error) {
      if (error instanceof DivisionByZeroError) {
        return failure('DIVISION_BY_ZERO', error.message);
      }
      if (error instanceof InvalidPowerError) {
        return failure('SYNTAX_ERROR', error.message);
      }
      throw error;
    }

    const violations = ruleEngine.validate(activeRules, { expression: parsed.expression });
    const common = { value: value.toString(), violations };
    const expected = Fraction.parse(challenge.expectedResult);

    if (!value.equals(expected)) {
      return failure(
        'WRONG_RESULT',
        equation
          ? `Tu expresión vale ${value}, pero la solución de la ecuación es x = ${expected}.`
          : `Tu expresión vale ${value}, pero el resultado esperado es ${expected}.`,
        common,
      );
    }

    if (parsed.claimedValue !== null && !parsed.claimedValue.equals(value)) {
      const claimed = parsed.claimedResult !== null ? parsed.claimedResult.toString() : parsed.claimedText;
      return failure(
        'CLAIMED_RESULT_MISMATCH',
        `Escribiste "= ${claimed}", pero tu expresión vale ${value}.`,
        common,
      );
    }

    if (violations.length > 0) {
      return failure('RULE_VIOLATION', violations.map((v) => v.message).join(' '), common);
    }

    return { isCorrect: true, failureReason: null, message: '¡Correcto!', ...common };
  }

  /**
   * Valor exacto del enunciado: el de la expresión o, si es una ecuación, su solución única (resuelta
   * de forma exacta; se rechazan las ecuaciones no lineales o sin solución única).
   *
   * @throws MathError si el enunciado no es evaluable/resoluble.
   */
  statementValue(
    challenge: Pick<ChallengeDefinition, 'expression' | 'statementKind'>,
    syntax: MathSyntax = DEFAULT_MATH_SYNTAX,
  ): Fraction {
    const { parser, evaluator } = this.deps;
    if (isEquation(challenge)) return solveLinearEquation(parser.parseEquation(challenge.expression, syntax));
    return evaluator.evaluate(parser.parseExpression(challenge.expression, syntax));
  }

  /**
   * Garantía de resolubilidad: el enunciado vale (o, si es ecuación, tiene como solución única) lo
   * declarado y la solución de referencia es una respuesta correcta con `rules` y la sintaxis del mundo.
   */
  verifySolvable(
    challenge: ChallengeDefinition,
    rules: readonly RuleDefinition[],
    syntax: MathSyntax = DEFAULT_MATH_SYNTAX,
  ): SolvabilityReport {
    try {
      const prompt = this.statementValue(challenge, syntax);
      const expected = Fraction.parse(challenge.expectedResult);
      if (!prompt.equals(expected)) {
        return unsolvable(
          isEquation(challenge)
            ? `La ecuación "${challenge.expression}" tiene solución x = ${prompt}, no ${expected}.`
            : `El enunciado "${challenge.expression}" vale ${prompt}, no ${expected}.`,
        );
      }
    } catch (error) {
      return unsolvable(
        `El enunciado "${challenge.expression}" no es evaluable: ${(error as Error).message}`,
      );
    }

    const evaluation = this.evaluateSubmission({
      challenge,
      activeRules: rules,
      submission: challenge.referenceSolution,
      syntax,
    });
    return evaluation.isCorrect
      ? { solvable: true, reason: null }
      : unsolvable(`La solución de referencia "${challenge.referenceSolution}" falla: ${evaluation.message}`);
  }
}

export function createChallengeEngine(ruleEngine: RuleEngine = createDefaultRuleEngine()): ChallengeEngine {
  return new ChallengeEngine({ parser: new ExpressionParser(), evaluator: new MathEvaluator(), ruleEngine });
}

function failure(
  failureReason: NonNullable<SubmissionEvaluation['failureReason']>,
  message: string,
  extra?: { value: string; violations: RuleViolation[] },
): SubmissionEvaluation {
  return {
    isCorrect: false,
    failureReason,
    message,
    value: extra?.value ?? null,
    violations: extra?.violations ?? [],
  };
}

function unsolvable(reason: string): SolvabilityReport {
  return { solvable: false, reason };
}
