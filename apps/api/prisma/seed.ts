/**
 * Siembra el catálogo (mundos, reglas y retos) desde las definiciones en código.
 * Es idempotente (upserts) y valida cada mundo antes de escribir: nunca se persiste
 * un reto sin solución que cumpla todas las reglas.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { createChallengeEngine, createDefaultRuleEngine } from '../src/modules/challenges';
import {
  arithmeticWorld,
  syncWorldCatalog,
  validateWorldDefinition,
  WorldDefinition,
} from '../src/modules/worlds';
import { PrismaClient } from '../src/generated/prisma/client';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

const worlds: readonly WorldDefinition[] = [arithmeticWorld];

async function main(): Promise<void> {
  const ruleEngine = createDefaultRuleEngine();
  const challengeEngine = createChallengeEngine(ruleEngine);
  worlds.forEach((world) => validateWorldDefinition(world, { ruleEngine, challengeEngine }));

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    await syncWorldCatalog(prisma, worlds);
    worlds.forEach((world) =>
      console.log(`Mundo "${world.slug}": ${world.rules.length} reglas, ${world.challenges.length} retos.`),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
