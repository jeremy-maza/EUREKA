/**
 * Siembra el catálogo (mundos, reglas y retos) desde las definiciones en código.
 * Es idempotente (upserts) y valida cada mundo antes de escribir: nunca se persiste
 * un reto sin solución que cumpla todas las reglas.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { createChallengeEngine, createDefaultRuleEngine } from '../src/modules/challenges';
import { arithmeticWorld, validateWorldDefinition, WorldDefinition } from '../src/modules/worlds';
import { PrismaClient } from '../src/generated/prisma/client';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

const worlds: readonly WorldDefinition[] = [arithmeticWorld];

async function seedWorld(prisma: PrismaClient, world: WorldDefinition): Promise<void> {
  const worldRow = await prisma.world.upsert({
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

  const ruleIdByKey = new Map<string, string>();
  for (const rule of world.rules) {
    const row = await prisma.rule.upsert({
      where: { worldId_key: { worldId: worldRow.id, key: rule.id } },
      create: {
        worldId: worldRow.id,
        key: rule.id,
        type: rule.type,
        description: rule.description,
        config: rule.config as object,
      },
      update: { type: rule.type, description: rule.description, config: rule.config as object },
    });
    ruleIdByKey.set(rule.id, row.id);
  }

  for (const challenge of world.challenges) {
    const data = {
      expression: challenge.expression,
      expectedResult: challenge.expectedResult,
      referenceSolution: challenge.referenceSolution,
      introducesRuleId: challenge.introducesRuleId
        ? (ruleIdByKey.get(challenge.introducesRuleId) ?? null)
        : null,
    };
    await prisma.challenge.upsert({
      where: { worldId_position: { worldId: worldRow.id, position: challenge.position } },
      create: { worldId: worldRow.id, position: challenge.position, ...data },
      update: data,
    });
  }

  console.log(`Mundo "${world.slug}": ${world.rules.length} reglas, ${world.challenges.length} retos.`);
}

async function main(): Promise<void> {
  const ruleEngine = createDefaultRuleEngine();
  const challengeEngine = createChallengeEngine(ruleEngine);
  worlds.forEach((world) => validateWorldDefinition(world, { ruleEngine, challengeEngine }));

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    for (const world of worlds) await seedWorld(prisma, world);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
