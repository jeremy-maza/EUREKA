import { ChallengeEngine, createChallengeEngine } from '../challenge-engine';
import { ChallengeDefinition } from '../challenge.types';
import {
  DivisionByZeroError,
  ExpressionNode,
  ExpressionParser,
  ExpressionSyntaxError,
  Fraction,
  MathEvaluator,
} from '../math';
import { RuleEngine, createDefaultRuleEngine } from '../rules';
import { fingerprintChallenge } from './challenge-fingerprint';
import { resolveGenerationRequest } from './generation-request';
import {
  BindingReport,
  CANDIDATE_REJECTIONS,
  CHALLENGE_GENERATOR_VERSION,
  CandidateRejection,
  ChallengeDifficultyProfile,
  ChallengeGenerationRequest,
  GenerationDiagnostics,
  GenerationLimits,
  GenerationResult,
  TemplateId,
} from './generation.types';
import { generateMultiplicativeStatement } from './multiplicative-templates';
import { RuleConstraints, checkRuleCompatibility } from './rule-compatibility';
import { SeededRandom, deriveSeed } from './seeded-random';
import { WitnessBuilder } from './witness-builder';

export interface ChallengeGeneratorDependencies {
  ruleEngine: RuleEngine;
  challengeEngine: ChallengeEngine;
  parser: ExpressionParser;
  evaluator: MathEvaluator;
}

type CandidateOutcome =
  | {
      accepted: true;
      challenge: ChallengeDefinition;
      fingerprint: string;
      templateId: TemplateId;
      witnessStrategy: string;
      binding: BindingReport;
    }
  | { accepted: false; rejection: CandidateRejection };

/**
 * Generador determinista y acotado de retos de la familia multiplicativa.
 *
 * Es puro (sin BD, sin NestJS, sin reloj ni `Math.random`) y reutiliza los motores existentes como
 * oráculo: `MathEvaluator` calcula el resultado, `RuleEngine` valida las reglas y
 * `ChallengeEngine.verifySolvable` da la aprobación final. Un reto NUNCA se devuelve como éxito si su
 * solución de referencia no pasa esa verificación.
 *
 * Flujo: validar petición → comprobar compatibilidad de reglas → hasta `maxCandidates` candidatos:
 * enunciado (plantilla + sub-semilla) → evaluarlo → huella/duplicados → "muerde" → solución →
 * `verifySolvable`.
 */
export class ChallengeGenerator {
  private readonly witnessBuilder: WitnessBuilder;

  constructor(private readonly deps: ChallengeGeneratorDependencies) {
    this.witnessBuilder = new WitnessBuilder(deps);
  }

  generate(request: ChallengeGenerationRequest): GenerationResult {
    const resolved = resolveGenerationRequest(request);
    if (!resolved.ok) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_REQUEST',
          message: 'La petición de generación no es válida.',
          problems: resolved.problems,
        },
      };
    }
    const { position, rules, introducesRuleId, seed, profile, limits, avoid, challengeId } = resolved.value;

    const compatibility = checkRuleCompatibility(rules, {
      ruleEngine: this.deps.ruleEngine,
      maxExpressionLength: limits.maxExpressionLength,
    });
    switch (compatibility.status) {
      case 'INVALID_CONFIG':
        return {
          ok: false,
          failure: {
            code: 'INVALID_RULE_CONFIG',
            message: 'Alguna regla activa tiene una configuración inválida.',
            issues: compatibility.issues,
          },
        };
      case 'UNSUPPORTED':
        return {
          ok: false,
          failure: {
            code: 'UNSUPPORTED_RULE',
            message: 'Alguna regla activa no está soportada por el generador.',
            issues: compatibility.issues,
          },
        };
      case 'INCOMPATIBLE':
        return {
          ok: false,
          failure: {
            code: 'INCOMPATIBLE_RULES',
            message: 'Las reglas activas son incompatibles: ningún reto puede cumplirlas.',
            conflicts: compatibility.conflicts,
          },
        };
      case 'NO_CONFLICT_FOUND':
        break;
    }
    const { constraints } = compatibility;

    const diagnostics = newDiagnostics(limits);
    for (let index = 0; index < limits.maxCandidates; index++) {
      diagnostics.candidatesTried += 1;
      const outcome = this.tryCandidate({
        index,
        position,
        introducesRuleId,
        seed,
        profile,
        limits,
        avoid,
        challengeId,
        constraints,
        diagnostics,
      });
      if (outcome.accepted) {
        return {
          ok: true,
          challenge: outcome.challenge,
          metadata: {
            fingerprint: outcome.fingerprint,
            generatorVersion: CHALLENGE_GENERATOR_VERSION,
            templateId: outcome.templateId,
            seed,
            candidateIndex: index,
            witnessStrategy: outcome.witnessStrategy,
            binding: outcome.binding,
            diagnostics,
          },
        };
      }
      diagnostics.rejections[outcome.rejection] += 1;
    }

    return {
      ok: false,
      failure: {
        code: 'GENERATION_EXHAUSTED',
        message: `No se encontró un reto válido y distinto en ${limits.maxCandidates} candidatos.`,
        diagnostics,
      },
    };
  }

  private tryCandidate(input: {
    index: number;
    position: number;
    introducesRuleId: string | null;
    seed: number;
    profile: ChallengeDifficultyProfile;
    limits: GenerationLimits;
    avoid: ReadonlySet<string>;
    challengeId: string | null;
    constraints: RuleConstraints;
    diagnostics: GenerationDiagnostics;
  }): CandidateOutcome {
    const { parser, evaluator, challengeEngine } = this.deps;
    const { index, position, seed, limits, constraints } = input;
    const rejected = (rejection: CandidateRejection): CandidateOutcome => ({ accepted: false, rejection });

    // 1. Enunciado: plantilla + sub-semilla propia del candidato.
    const statement = generateMultiplicativeStatement({
      rng: new SeededRandom(deriveSeed(seed, index, 0)),
      profile: input.profile,
      biasDigits: constraints.forbiddenDigits,
    });
    if (statement.expression.length > limits.maxExpressionLength) return rejected('INVALID_STATEMENT');

    // 2. El resultado esperado SIEMPRE sale del evaluador, nunca se asigna a mano.
    let ast: ExpressionNode;
    let value: Fraction;
    try {
      ast = parser.parseExpression(statement.expression);
      value = evaluator.evaluate(ast);
    } catch (error) {
      if (error instanceof ExpressionSyntaxError || error instanceof DivisionByZeroError) {
        return rejected('INVALID_STATEMENT');
      }
      throw error;
    }
    if (value.numerator <= 0n) return rejected('NON_POSITIVE_RESULT');
    if (!input.profile.allowFractions && !value.isInteger()) return rejected('FRACTIONAL_RESULT');

    // 3. Duplicados (antes de gastar presupuesto en la solución).
    const expectedResult = value.toString();
    const fingerprint = fingerprintChallenge(ast, value);
    if (input.avoid.has(fingerprint)) return rejected('DUPLICATE');

    // 4. El reto debe "morder": ni el enunciado ni el resultado literal evaden las reglas.
    const draft: ChallengeDefinition = {
      id: input.challengeId ?? `generated-${position}-${fingerprint.slice(-8)}`,
      position,
      expression: statement.expression,
      expectedResult,
      introducesRuleId: input.introducesRuleId,
      referenceSolution: expectedResult, // provisional: el binding no depende de la solución
    };
    const binding = this.checkBinding(draft, constraints);
    if (!binding.ok) return rejected('NOT_BINDING');

    // 5. Solución de referencia (reintentos con sub-semillas distintas).
    for (let attempt = 1; attempt <= limits.maxWitnessAttemptsPerCandidate; attempt++) {
      input.diagnostics.witnessAttempts += 1;
      const witness = this.witnessBuilder.build({
        target: value,
        constraints,
        rng: new SeededRandom(deriveSeed(seed, index, attempt)),
        maxLength: limits.maxExpressionLength,
      });
      if (!witness.ok) continue;

      // 6. Aprobación final con el motor existente.
      const challenge: ChallengeDefinition = { ...draft, referenceSolution: witness.expression };
      if (!challengeEngine.verifySolvable(challenge, constraints.rules).solvable) {
        return rejected('VERIFICATION_FAILED');
      }
      return {
        accepted: true,
        challenge,
        fingerprint,
        templateId: statement.templateId,
        witnessStrategy: witness.strategy,
        binding: binding.report,
      };
    }
    return rejected('NO_WITNESS');
  }

  /**
   * Exige (salvo en la posición 1 o sin reglas) que enviar el enunciado tal cual, o su resultado como
   * literal, sea rechazado por al menos una regla, usando `ChallengeEngine` como oráculo.
   */
  private checkBinding(
    draft: ChallengeDefinition,
    constraints: RuleConstraints,
  ): { ok: true; report: BindingReport } | { ok: false } {
    const enforced = draft.position > 1 && constraints.rules.length > 0;
    if (!enforced) return { ok: true, report: { enforced, statementViolations: [], resultViolations: [] } };

    const attempt = (submission: string) =>
      this.deps.challengeEngine.evaluateSubmission({
        challenge: draft,
        activeRules: constraints.rules,
        submission,
      });
    const statement = attempt(draft.expression);
    const result = attempt(draft.expectedResult);
    const bites = (e: typeof statement) => !e.isCorrect && e.failureReason === 'RULE_VIOLATION';
    if (!bites(statement) || !bites(result)) return { ok: false };

    return {
      ok: true,
      report: {
        enforced,
        statementViolations: statement.violations.map((v) => v.ruleId),
        resultViolations: result.violations.map((v) => v.ruleId),
      },
    };
  }
}

function newDiagnostics(limits: GenerationLimits): GenerationDiagnostics {
  const rejections = Object.fromEntries(CANDIDATE_REJECTIONS.map((r) => [r, 0])) as Record<
    CandidateRejection,
    number
  >;
  return { limits: { ...limits }, candidatesTried: 0, witnessAttempts: 0, rejections };
}

export function createChallengeGenerator(
  ruleEngine: RuleEngine = createDefaultRuleEngine(),
): ChallengeGenerator {
  return new ChallengeGenerator({
    ruleEngine,
    challengeEngine: createChallengeEngine(ruleEngine),
    parser: new ExpressionParser(),
    evaluator: new MathEvaluator(),
  });
}

let defaultGenerator: ChallengeGenerator | null = null;

/** Punto de entrada principal: genera un reto con los motores por defecto. */
export function generateChallenge(request: ChallengeGenerationRequest): GenerationResult {
  defaultGenerator ??= createChallengeGenerator();
  return defaultGenerator.generate(request);
}
