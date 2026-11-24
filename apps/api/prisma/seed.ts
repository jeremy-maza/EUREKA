/**
 * Siembra el catálogo (mundos y reglas) desde las definiciones en código. Es idempotente (upserts), nunca borra y
 * valida cada mundo antes de escribir (repertorio, compatibilidad de reglas y que se pueden planificar secuencias).
 * Los retos no se siembran: se generan al empezar cada secuencia.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { createChallengeEngine, createDefaultRuleEngine } from '../src/modules/challenges';
import { ALL_WORLDS } from '../src/modules/worlds/catalog';
import { syncWorldCatalog } from '../src/modules/worlds/catalog-sync';
import { validateWorldDefinition } from '../src/modules/worlds/world-validator';
import { PrismaClient } from '../src/generated/prisma/client';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

async function main(): Promise<void> {
  const ruleEngine = createDefaultRuleEngine();
  const challengeEngine = createChallengeEngine(ruleEngine);
  ALL_WORLDS.forEach((world) => validateWorldDefinition(world, { ruleEngine, challengeEngine }));

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    await syncWorldCatalog(prisma, ALL_WORLDS);
    for (const world of ALL_WORLDS) {
      const { EASIER, BASELINE, HARDER } = world.sequence.ruleCount;
      console.log(
        `Mundo ${world.position} "${world.slug}": ${world.rules.length} reglas; ${EASIER}/${BASELINE}/${HARDER} por secuencia.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
