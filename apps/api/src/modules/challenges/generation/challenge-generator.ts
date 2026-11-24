import { ChallengeEngine, createChallengeEngine } from '../challenge-engine';
import { ChallengeDefinition } from '../challenge.types';
import {
  ExpressionParser,
  Fraction,
  MathError,
  MathEvaluator,
  MathSyntax,
  solveLinearEquation,
} from '../math';
import { RuleEngine, createDefaultRuleEngine } from '../rules';
import { fingerprintChallenge, fingerprintEquation } from './challenge-fingerprint';
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
  StatementFamily,
  TemplateId,
  WeightedFamily,
} from './generation.types';
import { generateMultiplicativeStatement } from './multiplicative-templates';
import { RuleConstraints, checkRuleCompatibility } from './rule-compatibility';
import { SeededRandom, deriveSeed } from './seeded-random';
import { FamilyStatement, familyRejection, generateFamilyStatement } from './statement-families';
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
      family: StatementFamily;
      witnessStrategy: string;
      binding: BindingReport;
    }
  | { accepted: false; rejection: CandidateRejection };

/**
 * Generador determinista y acotado de retos (familias de enunciados por mundo).
 *
 * Es puro (sin BD, sin NestJS, sin reloj ni `Math.random`) y reutiliza los motores existentes como
 * oráculo: `MathEvaluator`/`solveLinearEquation` calculan el resultado, `RuleEngine` valida las reglas y
 * `ChallengeEngine.verifySolvable` (con la sintaxis del mundo) da la aprobación final. Un reto NUNCA se
 * devuelve como éxito si su solución de referencia no pasa esa verificación.
 *
 * Flujo: validar petición → comprobar compatibilidad de reglas → hasta `maxCandidates` candidatos:
 * familia + enunciado (sub-semilla) → evaluarlo/resolverlo → aceptación del valor → huella/duplicados →
 * "muerde" → solución → `verifySolvable`.
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
    const { position, rules, introducesRuleId, seed, profile, limits, avoid, challengeId, families, syntax } =
      resolved.value;

    const compatibility = checkRuleCompatibility(rules, {
      ruleEngine: this.deps.ruleEngine,
      maxExpressionLength: limits.maxExpressionLength,
      syntax,
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
        families,
        syntax,
      });
      if (outcome.accepted) {
        return {
          ok: true,
          challenge: outcome.challenge,
          metadata: {
            fingerprint: outcome.fingerprint,
            generatorVersion: CHALLENGE_GENERATOR_VERSION,
            templateId: outcome.templateId,
            family: outcome.family,
            statementKind: outcome.challenge.statementKind ?? 'EXPRESSION',
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
    families: readonly WeightedFamily[] | null;
    syntax: MathSyntax;
  }): CandidateOutcome {
    const { parser, evaluator, challengeEngine } = this.deps;
    const { index, position, seed, limits, constraints, syntax } = input;
    const rejected = (rejection: CandidateRejection): CandidateOutcome => ({ accepted: false, rejection });

    // 1. Enunciado: familia + plantilla con la sub-semilla propia del candidato.
    const statement = this.drawStatement(input);
    if (statement === null || statement.expression.length > limits.maxExpressionLength) {
      return rejected('INVALID_STATEMENT');
    }
    const equation = statement.kind === 'EQUATION';

    // 2. El resultado esperado SIEMPRE sale del evaluador (o del solver exacto), nunca se asigna a mano.
    let value: Fraction;
    let fingerprint: string;
    try {
      if (equation) {
        const parsed = parser.parseEquation(statement.expression, syntax);
        value = solveLinearEquation(parsed);
        fingerprint = fingerprintEquation(parsed, value);
      } else {
        const ast = parser.parseExpression(statement.expression, syntax);
        value = evaluator.evaluate(ast);
        fingerprint = fingerprintChallenge(ast, value);
      }
    } catch (error) {
      if (error instanceof MathError) return rejected('INVALID_STATEMENT');
      throw error;
    }
    const valueRejection = familyRejection(statement.family, value, input.profile);
    if (valueRejection !== null) return rejected(valueRejection);

    // 3. Duplicados (antes de gastar presupuesto en la solución).
    if (input.avoid.has(fingerprint)) return rejected('DUPLICATE');

    // 4. El reto debe "morder": ni el enunciado ni el resultado literal evaden las reglas.
    const expectedResult = value.toString();
    const draft: ChallengeDefinition = {
      id: input.challengeId ?? `generated-${position}-${fingerprint.slice(-8)}`,
      position,
      expression: statement.expression,
      expectedResult,
      introducesRuleId: input.introducesRuleId,
      referenceSolution: expectedResult, // provisional: el binding no depende de la solución
      ...(input.families === null ? {} : { statementKind: statement.kind }),
    };
    const binding = this.checkBinding(draft, value, constraints, syntax);
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

      // 6. Aprobación final con el motor existente (y la sintaxis del mundo).
      const challenge: ChallengeDefinition = { ...draft, referenceSolution: witness.expression };
      if (!challengeEngine.verifySolvable(challenge, constraints.rules, syntax).solvable) {
        return rejected('VERIFICATION_FAILED');
      }
      return {
        accepted: true,
        challenge,
        fingerprint,
        templateId: statement.templateId,
        family: statement.family,
        witnessStrategy: witness.strategy,
        binding: binding.report,
      };
    }
    return rejected('NO_WITNESS');
  }

  /**
   * Sin `families` se conserva EXACTAMENTE el flujo original (familia multiplicativa, mismo consumo del
   * RNG). Con `families`, el mismo RNG del candidato sortea la familia (por peso) y luego la plantilla.
   */
  private drawStatement(input: {
    index: number;
    seed: number;
    profile: ChallengeDifficultyProfile;
    constraints: RuleConstraints;
    families: readonly WeightedFamily[] | null;
    syntax: MathSyntax;
  }): FamilyStatement | null {
    const rng = new SeededRandom(deriveSeed(input.seed, input.index, 0));
    const biasDigits = input.constraints.forbiddenDigits;
    if (input.families === null) {
      const statement = generateMultiplicativeStatement({ rng, profile: input.profile, biasDigits });
      return { family: 'MULTIPLICATIVE', ...statement, kind: 'EXPRESSION' };
    }
    const family = pickWeighted(rng, input.families);
    const { parser, evaluator } = this.deps;
    return generateFamilyStatement(family, {
      rng,
      profile: input.profile,
      biasDigits,
      syntax: input.syntax,
      evaluate: (text) => evaluator.evaluate(parser.parseExpression(text, input.syntax)),
    });
  }

  /**
   * Exige (salvo en la posición 1 o sin reglas) que enviar el enunciado tal cual, o su resultado como
   * literal (en todas sus escrituras: `7/2` y, con decimales, `3.5`), sea rechazado por al menos una regla,
   * usando `ChallengeEngine` como oráculo. Una ecuación no se puede enviar (contiene `x`): solo cuenta el
   * resultado.
   */
  private checkBinding(
    draft: ChallengeDefinition,
    value: Fraction,
    constraints: RuleConstraints,
    syntax: MathSyntax,
  ): { ok: true; report: BindingReport } | { ok: false } {
    const enforced = draft.position > 1 && constraints.rules.length > 0;
    if (!enforced) return { ok: true, report: { enforced, statementViolations: [], resultViolations: [] } };

    const attempt = (submission: string) =>
      this.deps.challengeEngine.evaluateSubmission({
        challenge: draft,
        activeRules: constraints.rules,
        submission,
        syntax,
      });
    const bites = (e: ReturnType<typeof attempt>) => !e.isCorrect && e.failureReason === 'RULE_VIOLATION';

    let statementViolations: string[] = [];
    if (draft.statementKind !== 'EQUATION') {
      const statement = attempt(draft.expression);
      if (!bites(statement)) return { ok: false };
      statementViolations = statement.violations.map((v) => v.ruleId);
    }

    const resultViolations = new Set<string>();
    for (const form of resultForms(value, syntax)) {
      const result = attempt(form);
      if (!bites(result)) return { ok: false };
      result.violations.forEach((v) => resultViolations.add(v.ruleId));
    }

    return { ok: true, report: { enforced, statementViolations, resultViolations: [...resultViolations] } };
  }
}

/** Escrituras "literales" del resultado: la canónica (`-3`, `7/2`) y, si hay decimales, la decimal exacta. */
export function resultForms(value: Fraction, syntax: MathSyntax): string[] {
  const forms = [value.toString()];
  if (syntax.decimals && !value.isInteger()) {
    const decimal = value.toTerminatingDecimal();
    if (decimal !== null) forms.push(decimal);
  }
  return forms;
}

function pickWeighted(rng: SeededRandom, items: readonly WeightedFamily[]): StatementFamily {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let ticket = rng.nextInt(1, total);
  for (const item of items) {
    ticket -= item.weight;
    if (ticket <= 0) return item.family;
  }
  return items[items.length - 1].family;
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
