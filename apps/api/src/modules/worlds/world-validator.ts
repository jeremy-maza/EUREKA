import { ChallengeEngine, RuleConfigurationError, RuleEngine } from '../challenges';
import { WorldDefinition } from './world.types';

export class WorldDefinitionError extends Error {
  constructor(
    readonly worldSlug: string,
    readonly problems: readonly string[],
  ) {
    super(`Definición inválida del mundo "${worldSlug}":\n - ${problems.join('\n - ')}`);
    this.name = 'WorldDefinitionError';
  }
}

/**
 * Valida un catálogo de mundo. Garantiza, entre otras cosas, que CADA reto es resoluble
 * cumpliendo todas las reglas del mundo a la vez (lo que cubre cualquier subconjunto acumulado).
 * Debe ejecutarse al arrancar, en el seed y antes de persistir retos generados.
 *
 * @throws WorldDefinitionError con la lista completa de problemas.
 */
export function validateWorldDefinition(
  world: WorldDefinition,
  engines: { ruleEngine: RuleEngine; challengeEngine: ChallengeEngine },
): void {
  const problems: string[] = [];
  const ruleIds = new Set<string>();

  for (const rule of world.rules) {
    if (ruleIds.has(rule.id)) problems.push(`Regla duplicada: "${rule.id}".`);
    ruleIds.add(rule.id);
    try {
      engines.ruleEngine.assertValidDefinition(rule);
    } catch (error) {
      if (!(error instanceof RuleConfigurationError)) throw error;
      problems.push(error.message);
    }
  }

  if (world.challenges.length === 0) problems.push('El mundo no tiene retos.');

  const challengeIds = new Set<string>();
  const introducedRules = new Set<string>();

  world.challenges.forEach((challenge, index) => {
    if (challengeIds.has(challenge.id)) problems.push(`Reto duplicado: "${challenge.id}".`);
    challengeIds.add(challenge.id);

    if (challenge.position !== index + 1) {
      problems.push(
        `El reto "${challenge.id}" tiene position ${challenge.position}; se esperaba ${index + 1}.`,
      );
    }

    if (challenge.introducesRuleId !== null) {
      if (!ruleIds.has(challenge.introducesRuleId)) {
        problems.push(
          `El reto "${challenge.id}" introduce la regla inexistente "${challenge.introducesRuleId}".`,
        );
      } else if (introducedRules.has(challenge.introducesRuleId)) {
        problems.push(`La regla "${challenge.introducesRuleId}" la introduce más de un reto.`);
      }
      introducedRules.add(challenge.introducesRuleId);
    }
  });

  for (const rule of world.rules) {
    if (!introducedRules.has(rule.id)) problems.push(`La regla "${rule.id}" no la introduce ningún reto.`);
  }

  // La resolubilidad solo se puede comprobar si las reglas son válidas.
  if (problems.length === 0) {
    for (const challenge of world.challenges) {
      const report = engines.challengeEngine.verifySolvable(challenge, world.rules);
      if (!report.solvable) problems.push(`Reto "${challenge.id}" no resoluble: ${report.reason}`);
    }
  }

  if (problems.length > 0) throw new WorldDefinitionError(world.slug, problems);
}
