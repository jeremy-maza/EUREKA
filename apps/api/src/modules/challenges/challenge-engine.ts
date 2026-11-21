import { ChallengeDefinition, SolvabilityReport, SubmissionEvaluation } from './challenge.types';
import {
  DivisionByZeroError,
  ExpressionParser,
  ExpressionSyntaxError,
  Fraction,
  MathEvaluator,
  ParsedAnswer,
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
}

/**
 * Evalúa una respuesta frente a un reto. Mantiene separadas las dos responsabilidades:
 *   1. Matemática: parsear + evaluar (MathEvaluator).
 *   2. Reglas: validar el AST contra las reglas activas (RuleEngine).
 * Es puro: no depende de HTTP, base de datos ni reloj (el tiempo lo gestiona `TimerManager`).
 */
export class ChallengeEngine {
  constructor(private readonly deps: ChallengeEngineDependencies) {}

  evaluateSubmission({ challenge, activeRules, submission }: EvaluateSubmissionInput): SubmissionEvaluation {
    const { parser, evaluator, ruleEngine } = this.deps;

    let parsed: ParsedAnswer;
    try {
      parsed = parser.parseAnswer(submission);
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
      throw error;
    }

    const violations = ruleEngine.validate(activeRules, { expression: parsed.expression });
    const common = { value: value.toString(), violations };
    const expected = Fraction.parse(challenge.expectedResult);

    if (!value.equals(expected)) {
      return failure(
        'WRONG_RESULT',
        `Tu expresión vale ${value}, pero el resultado esperado es ${expected}.`,
        common,
      );
    }

    if (parsed.claimedResult !== null && !Fraction.of(parsed.claimedResult).equals(value)) {
      return failure(
        'CLAIMED_RESULT_MISMATCH',
        `Escribiste "= ${parsed.claimedResult}", pero tu expresión vale ${value}.`,
        common,
      );
    }

    if (violations.length > 0) {
      return failure('RULE_VIOLATION', violations.map((v) => v.message).join(' '), common);
    }

    return { isCorrect: true, failureReason: null, message: '¡Correcto!', ...common };
  }

  /**
   * Garantía de resolubilidad: el enunciado vale lo declarado y la solución de referencia
   * cumple `rules` (normalmente todas las reglas del mundo).
   */
  verifySolvable(challenge: ChallengeDefinition, rules: readonly RuleDefinition[]): SolvabilityReport {
    const { parser, evaluator } = this.deps;

    try {
      const prompt = evaluator.evaluate(parser.parseExpression(challenge.expression));
      const expected = Fraction.parse(challenge.expectedResult);
      if (!prompt.equals(expected)) {
        return unsolvable(`El enunciado "${challenge.expression}" vale ${prompt}, no ${expected}.`);
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
