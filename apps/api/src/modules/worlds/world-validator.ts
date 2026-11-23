import {
  ChallengeEngine,
  ChallengeGenerator,
  ExpressionParser,
  MathEvaluator,
  RuleConfigurationError,
  RuleEngine,
  checkRuleCompatibility,
  resolveGenerationRequest,
} from '../challenges';
import { SequencePlan, SequencePlanningError } from '../sequences/sequence.types';
import { planSequence } from '../sequences/sequence-planner';
import { DIFFICULTY_LEVELS, DifficultyLevel, WorldDefinition } from './world.types';

export class WorldDefinitionError extends Error {
  constructor(
    readonly worldSlug: string,
    readonly problems: readonly string[],
  ) {
    super(`Definición inválida del mundo "${worldSlug}":\n - ${problems.join('\n - ')}`);
    this.name = 'WorldDefinitionError';
  }
}

export interface WorldValidationDependencies {
  ruleEngine: RuleEngine;
  challengeEngine: ChallengeEngine;
}

/** Semillas fijas de la prueba de planificación (por nivel). Deterministas: el arranque es reproducible. */
export const WORLD_VALIDATION_SEEDS: readonly number[] = [1, 2, 3, 4];

const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const RULE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Valida un catálogo de mundo. Debe ejecutarse al arrancar y en el seed; tarda unos milisegundos.
 *
 *  1. Datos básicos (slug, nombre, posición, conceptos, sintaxis, tiempo extra).
 *  2. Repertorio de reglas: ids únicos con forma "<slug>.<kebab>" y configuraciones válidas.
 *  3. `ruleCount`: enteros con 1 ≤ EASIER ≤ BASELINE ≤ HARDER ≤ tamaño del repertorio.
 *  4. Perfiles del generador válidos para la sintaxis del mundo (familias, rangos).
 *  5. Compatibilidad DEMOSTRADA del repertorio completo (cubre cualquier subconjunto: un conflicto entre
 *     reglas de un subconjunto también lo es del repertorio).
 *  6. Prueba de planificación: para cada nivel y cada semilla de `WORLD_VALIDATION_SEEDS` se planifica una
 *     secuencia y se vuelve a verificar CADA reto con `challengeEngine.verifySolvable` (con sus reglas activas
 *     y la sintaxis del mundo), además de la forma del plan.
 *
 * @throws WorldDefinitionError con la lista completa de problemas.
 */
export function validateWorldDefinition(world: WorldDefinition, deps: WorldValidationDependencies): void {
  const problems: string[] = [];

  if (typeof world.slug !== 'string' || !SLUG.test(world.slug))
    problems.push(`Slug inválido: "${world.slug}".`);
  if (typeof world.name !== 'string' || world.name.trim().length === 0)
    problems.push('El mundo no tiene nombre.');
  if (!Number.isSafeInteger(world.position) || world.position < 1) {
    problems.push(`"position" debe ser un entero ≥ 1 (es ${world.position}).`);
  }
  if (
    !Array.isArray(world.concepts) ||
    world.concepts.length === 0 ||
    world.concepts.some((c) => typeof c !== 'string' || c.trim().length === 0)
  ) {
    problems.push('"concepts" debe ser una lista no vacía de textos.');
  }
  if (typeof world.syntax?.decimals !== 'boolean' || typeof world.syntax?.powers !== 'boolean') {
    problems.push('"syntax" debe tener "decimals" y "powers" booleanos.');
  }
  const extra = world.sequence?.extraTimeSeconds;
  if (!Number.isSafeInteger(extra) || extra < 0) {
    problems.push(`"sequence.extraTimeSeconds" debe ser un entero ≥ 0 (es ${extra}).`);
  }

  // 2. Repertorio.
  const ruleIds = new Set<string>();
  if (world.rules.length === 0) problems.push('El mundo no tiene reglas.');
  for (const rule of world.rules) {
    if (ruleIds.has(rule.id)) problems.push(`Regla duplicada: "${rule.id}".`);
    ruleIds.add(rule.id);
    const [prefix, key, ...rest] = rule.id.split('.');
    if (prefix !== world.slug || key === undefined || rest.length > 0 || !RULE_KEY.test(key)) {
      problems.push(`El id de regla "${rule.id}" debe tener la forma "${world.slug}.<nombre-en-kebab>".`);
    }
    if (typeof rule.description !== 'string' || rule.description.trim().length === 0) {
      problems.push(`La regla "${rule.id}" no tiene descripción.`);
    }
    try {
      deps.ruleEngine.assertValidDefinition(rule);
    } catch (error) {
      if (!(error instanceof RuleConfigurationError)) throw error;
      problems.push(error.message);
    }
  }

  // 3. ruleCount.
  const counts = DIFFICULTY_LEVELS.map((level) => world.sequence?.ruleCount?.[level]);
  if (counts.some((count) => !Number.isSafeInteger(count))) {
    problems.push('"sequence.ruleCount" debe tener un entero para EASIER, BASELINE y HARDER.');
  } else {
    const [easier, baseline, harder] = counts as number[];
    if (!(easier >= 1 && easier <= baseline && baseline <= harder && harder <= world.rules.length)) {
      problems.push(
        `"sequence.ruleCount" debe cumplir 1 ≤ EASIER ≤ BASELINE ≤ HARDER ≤ ${world.rules.length} ` +
          `(es ${easier}/${baseline}/${harder}).`,
      );
    }
  }

  // 4. Perfiles del generador (se validan con el mismo resolutor que usa el generador).
  for (const level of DIFFICULTY_LEVELS) {
    const profile = world.generation?.profiles?.[level];
    if (!profile) {
      problems.push(`Falta el perfil de generación ${level}.`);
      continue;
    }
    for (const [name, value] of [
      ['first', profile.first],
      ['last', profile.last],
    ] as const) {
      const resolved = resolveGenerationRequest({
        position: 1,
        activeRules: [],
        seed: 0,
        profile: value,
        families: profile.families,
        syntax: world.syntax,
      });
      if (!resolved.ok) problems.push(...resolved.problems.map((p) => `Perfil ${level}.${name}: ${p}`));
    }
  }

  // 5. Compatibilidad del repertorio completo.
  if (problems.length === 0) {
    const compatibility = checkRuleCompatibility(world.rules, {
      ruleEngine: deps.ruleEngine,
      syntax: world.syntax,
    });
    if (compatibility.status === 'INCOMPATIBLE') {
      problems.push(...compatibility.conflicts.map((c) => `Reglas incompatibles (${c.code}): ${c.message}`));
    } else if (compatibility.status !== 'NO_CONFLICT_FOUND') {
      problems.push(...compatibility.issues.map((i) => `Regla no soportada por el generador: ${i.message}`));
    }
  }

  // 6. Prueba de planificación (solo si todo lo anterior es correcto).
  if (problems.length === 0) {
    const generator = new ChallengeGenerator({
      ruleEngine: deps.ruleEngine,
      challengeEngine: deps.challengeEngine,
      parser: new ExpressionParser(),
      evaluator: new MathEvaluator(),
    });
    for (const difficulty of DIFFICULTY_LEVELS) {
      for (const seed of WORLD_VALIDATION_SEEDS) {
        try {
          const plan = planSequence(world, { seed, difficulty }, { generator });
          problems.push(...planProblems(world, plan, difficulty, deps.challengeEngine));
        } catch (error) {
          if (!(error instanceof SequencePlanningError)) throw error;
          problems.push(error.message);
        }
      }
    }
  }

  if (problems.length > 0) throw new WorldDefinitionError(world.slug, problems);
}

/**
 * Valida el catálogo completo: cada mundo y, además, slugs únicos y posiciones 1..n sin huecos.
 * @throws WorldDefinitionError (con slug "*" si el problema es del conjunto).
 */
export function validateWorldCatalog(
  worlds: readonly WorldDefinition[],
  deps: WorldValidationDependencies,
): void {
  const problems: string[] = [];
  const slugs = new Set(worlds.map((w) => w.slug));
  if (slugs.size !== worlds.length) problems.push('Hay slugs de mundo repetidos.');
  const positions = worlds.map((w) => w.position).sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index + 1)) {
    problems.push(`Las posiciones deben ser 1..${worlds.length} sin huecos (son ${positions.join(', ')}).`);
  }
  if (problems.length > 0) throw new WorldDefinitionError('*', problems);
  for (const world of worlds) validateWorldDefinition(world, deps);
}

/** Comprobaciones independientes del planificador sobre un plan ya hecho. */
export function planProblems(
  world: WorldDefinition,
  plan: SequencePlan,
  difficulty: DifficultyLevel,
  challengeEngine: ChallengeEngine,
): string[] {
  const problems: string[] = [];
  const label = `Plan ${difficulty} seed ${plan.seed}`;
  const k = world.sequence.ruleCount[difficulty];
  const byId = new Map(world.rules.map((rule) => [rule.id, rule]));
  if (
    plan.ruleIds.length !== k ||
    new Set(plan.ruleIds).size !== k ||
    plan.ruleIds.some((id) => !byId.has(id))
  ) {
    problems.push(`${label}: "ruleIds" no es un subconjunto de ${k} reglas del mundo.`);
    return problems;
  }
  if (plan.challenges.length !== k + 1)
    problems.push(`${label}: tiene ${plan.challenges.length} retos, no ${k + 1}.`);
  const fingerprints = new Set(plan.challenges.map((c) => c.generation.fingerprint));
  if (fingerprints.size !== plan.challenges.length) problems.push(`${label}: hay retos repetidos.`);
  plan.challenges.forEach((challenge, index) => {
    const expected = index === 0 ? null : plan.ruleIds[index - 1];
    if (challenge.position !== index + 1 || challenge.introducesRuleId !== expected) {
      problems.push(`${label}: el reto ${index + 1} tiene posición o regla introducida incorrectas.`);
    }
    const active = plan.ruleIds.slice(0, index).map((id) => byId.get(id)!);
    const report = challengeEngine.verifySolvable(challenge, active, world.syntax);
    if (!report.solvable) problems.push(`${label}: el reto ${index + 1} no es resoluble: ${report.reason}`);
  });
  return problems;
}
