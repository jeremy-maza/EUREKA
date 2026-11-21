import { PrismaClient } from '../../generated/prisma/client';
import { WorldDefinition } from './world.types';

/** Subconjunto de PrismaClient/TransactionClient que necesita la sincronización. */
type CatalogDb = Pick<PrismaClient, 'world' | 'rule' | 'challenge'>;

/**
 * Persiste (upsert idempotente) mundos, reglas y retos desde las definiciones en código.
 * El llamador debe haber validado antes cada mundo con `validateWorldDefinition`.
 */
export async function syncWorldCatalog(db: CatalogDb, worlds: readonly WorldDefinition[]): Promise<void> {
  for (const world of worlds) {
    const worldRow = await db.world.upsert({
      where: { slug: world.slug },
      create: {
        slug: world.slug,
        name: world.name,
        description: world.description,
        position: world.position,
        isEnabled: true,
      },
      update: { name: world.name, description: world.description, position: world.position },
    });

    const ruleRowIdByKey = new Map<string, string>();
    for (const rule of world.rules) {
      const data = { type: rule.type, description: rule.description, config: rule.config as object };
      const row = await db.rule.upsert({
        where: { worldId_key: { worldId: worldRow.id, key: rule.id } },
        create: { worldId: worldRow.id, key: rule.id, ...data },
        update: data,
      });
      ruleRowIdByKey.set(rule.id, row.id);
    }

    for (const challenge of world.challenges) {
      const data = {
        key: challenge.id,
        expression: challenge.expression,
        expectedResult: challenge.expectedResult,
        referenceSolution: challenge.referenceSolution,
        introducesRuleId: challenge.introducesRuleId
          ? (ruleRowIdByKey.get(challenge.introducesRuleId) ?? null)
          : null,
      };
      await db.challenge.upsert({
        where: { worldId_position: { worldId: worldRow.id, position: challenge.position } },
        create: { worldId: worldRow.id, position: challenge.position, ...data },
        update: data,
      });
    }
  }
}
