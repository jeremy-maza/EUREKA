import {
  CHALLENGE_GENERATOR_VERSION,
  ChallengeGenerator,
  GenerationFailure,
  RuleDefinition,
  SeededRandom,
  createChallengeGenerator,
  deriveSeed,
  profileForPosition,
} from '../challenges';
import { DIFFICULTY_LEVELS, WorldDefinition } from '../worlds/world.types';
import {
  MAX_SEQUENCE_SEED,
  PlanSequenceInput,
  PlannedChallenge,
  SequencePlan,
  SequencePlanningError,
} from './sequence.types';

/**
 * Presupuestos deterministas del planificador. Acotan el trabajo en el peor caso (se ejecuta dentro de una
 * transacción HTTP): sorteos × posiciones × semillas por posición × candidatos del generador.
 */
export const SEQUENCE_PLANNER_LIMITS = {
  /** Sorteos de subconjunto y orden (el primero con la semilla de la secuencia, los demás derivados). */
  maxDraws: 6,
  /** Semillas que se prueban por posición antes de abandonar el sorteo. */
  seedsPerPosition: 2,
  /** Presupuesto del generador por reto. */
  maxCandidates: 150,
  maxWitnessAttemptsPerCandidate: 3,
} as const;

export interface PlanSequenceOptions {
  /** Generador a usar (por defecto, uno con los motores de producción). */
  generator?: ChallengeGenerator;
}

/** Resultado de planificar un orden de reglas concreto (sin volver a sortear). */
export type RulesPlanResult =
  { ok: true; plan: SequencePlan } | { ok: false; position: number; failure: GenerationFailure };

let defaultGenerator: ChallengeGenerator | null = null;

function generatorOf(options: PlanSequenceOptions): ChallengeGenerator {
  if (options.generator) return options.generator;
  defaultGenerator ??= createChallengeGenerator();
  return defaultGenerator;
}

/** Las semillas derivadas se reducen a 31 bits para que quepan en un INTEGER de PostgreSQL. */
function seed31(value: number): number {
  return value >>> 1;
}

/**
 * Sal estable por (mundo, dificultad): la misma semilla en otro mundo o nivel da un plan independiente
 * (sin ella, las semillas 1, 2, 3… producirían retos casi iguales en todos los mundos).
 */
function planSalt(world: WorldDefinition, difficulty: PlanSequenceInput['difficulty']): number {
  let hash = 0x811c9dc5;
  for (const char of `${world.slug}|${difficulty}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return hash;
}

function assertInput(world: WorldDefinition, input: PlanSequenceInput): void {
  if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > MAX_SEQUENCE_SEED) {
    throw new RangeError(
      `La semilla de la secuencia debe ser un entero en [0, ${MAX_SEQUENCE_SEED}] (recibido: ${input.seed}).`,
    );
  }
  if (!DIFFICULTY_LEVELS.includes(input.difficulty)) {
    throw new RangeError(`Dificultad desconocida: "${String(input.difficulty)}".`);
  }
  const k = world.sequence.ruleCount[input.difficulty];
  if (!Number.isSafeInteger(k) || k < 1 || k > world.rules.length) {
    throw new SequencePlanningError(
      world.slug,
      `ruleCount.${input.difficulty} = ${k} no es válido para un repertorio de ${world.rules.length} reglas.`,
    );
  }
}

/**
 * Planifica una secuencia completa del mundo. Puro y determinista: (mundo, seed, dificultad) ⇒ el mismo plan.
 *
 *  1. Sortea (SeededRandom, con una sal por mundo y nivel) un subconjunto de `k = ruleCount[dificultad]`
 *     reglas y su orden.
 *  2. Genera un reto por posición: el 1 sin regla; el i introduce `ruleIds[i - 2]` con todas las anteriores
 *     activas. El perfil crece dentro de la secuencia (`profileForPosition`) y con el nivel.
 *  3. Sin huellas repetidas dentro de la secuencia; cada reto ha pasado `verifySolvable` con exactamente sus
 *     reglas activas y la sintaxis del mundo (lo garantiza el generador) y "muerde" desde la posición 2.
 *  4. Si algún reto no se puede generar, vuelve a sortear con semillas derivadas (como mucho `maxDraws`).
 *
 * @throws SequencePlanningError solo si el catálogo es defectuoso (ningún sorteo se pudo planificar).
 * @throws RangeError si la semilla o la dificultad no son válidas.
 */
export function planSequence(
  world: WorldDefinition,
  input: PlanSequenceInput,
  options: PlanSequenceOptions = {},
): SequencePlan {
  assertInput(world, input);
  const k = world.sequence.ruleCount[input.difficulty];
  const failures: string[] = [];

  for (let draw = 0; draw < SEQUENCE_PLANNER_LIMITS.maxDraws; draw++) {
    const rng = new SeededRandom(deriveSeed(input.seed, planSalt(world, input.difficulty), draw));
    const ruleIds = rng
      .shuffle(world.rules)
      .slice(0, k)
      .map((rule) => rule.id);
    const result = planSequenceForRules(world, ruleIds, input, options, draw);
    if (result.ok) return result.plan;
    failures.push(`[${ruleIds.join(', ')}] posición ${result.position}: ${result.failure.code}`);
  }

  throw new SequencePlanningError(
    world.slug,
    `No se pudo planificar una secuencia ${input.difficulty} (seed ${input.seed}) del mundo "${world.slug}" ` +
      `tras ${SEQUENCE_PLANNER_LIMITS.maxDraws} sorteos: ${failures.join('; ')}`,
  );
}

/**
 * Planifica la secuencia para un orden de reglas DADO (sin volver a sortear). Lo usa `planSequence` y sirve
 * para comprobar de forma exhaustiva que cada subconjunto y orden del repertorio es planificable.
 *
 * @param draw índice del sorteo (sal de las semillas de los retos); 0 por defecto.
 */
export function planSequenceForRules(
  world: WorldDefinition,
  ruleIds: readonly string[],
  input: PlanSequenceInput,
  options: PlanSequenceOptions = {},
  draw = 0,
): RulesPlanResult {
  const generator = generatorOf(options);
  const byId = new Map(world.rules.map((rule) => [rule.id, rule]));
  const rules: RuleDefinition[] = ruleIds.map((id) => {
    const rule = byId.get(id);
    if (!rule) throw new SequencePlanningError(world.slug, `La regla "${id}" no pertenece al mundo.`);
    return rule;
  });
  const level = world.generation.profiles[input.difficulty];
  const length = rules.length + 1;
  const used: string[] = [];
  const challenges: PlannedChallenge[] = [];

  for (let position = 1; position <= length; position++) {
    const activeRules = rules.slice(0, position - 1);
    const introducesRuleId = position === 1 ? null : rules[position - 2].id;
    const profile = profileForPosition(level, position, length);
    let lastFailure: GenerationFailure | null = null;
    let planned: PlannedChallenge | null = null;

    for (let attempt = 0; attempt < SEQUENCE_PLANNER_LIMITS.seedsPerPosition && planned === null; attempt++) {
      const seed = seed31(deriveSeed(input.seed, planSalt(world, input.difficulty), draw, position, attempt));
      const result = generator.generate({
        position,
        activeRules,
        introducesRuleId,
        seed,
        profile,
        families: level.families,
        syntax: world.syntax,
        avoidFingerprints: used,
        challengeId: `${world.slug}.${input.difficulty.toLowerCase()}.${input.seed}.${position}`,
        limits: {
          maxCandidates: SEQUENCE_PLANNER_LIMITS.maxCandidates,
          maxWitnessAttemptsPerCandidate: SEQUENCE_PLANNER_LIMITS.maxWitnessAttemptsPerCandidate,
        },
      });
      if (!result.ok) {
        lastFailure = result.failure;
        // Un fallo que no depende de la semilla no se arregla reintentando.
        if (result.failure.code !== 'GENERATION_EXHAUSTED') break;
        continue;
      }
      planned = {
        ...result.challenge,
        statementKind: result.challenge.statementKind ?? 'EXPRESSION',
        generation: {
          fingerprint: result.metadata.fingerprint,
          generatorVersion: result.metadata.generatorVersion,
          templateId: result.metadata.templateId,
          seed,
        },
      };
    }

    if (planned === null) return { ok: false, position, failure: lastFailure as GenerationFailure };
    used.push(planned.generation.fingerprint);
    challenges.push(planned);
  }

  return {
    ok: true,
    plan: {
      worldSlug: world.slug,
      seed: input.seed,
      difficulty: input.difficulty,
      ruleIds: [...ruleIds],
      challenges,
      generatorVersion: CHALLENGE_GENERATOR_VERSION,
    },
  };
}
