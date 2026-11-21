/**
 * Purga registros de autenticación caducados (sesiones, tokens de recuperación, contadores de intentos) según
 * `AUTH_RETENTION_DAYS`. Pensado para un cron cuando la API no hace la purga en proceso:
 *
 *   npm run auth:cleanup -w apps/api
 *
 * Solo borra lo caducado hace más de la retención; el historial reciente (revocado o consumido) se conserva.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { buildAuthConfig } from '../src/config/auth.config';
import { PrismaClient } from '../src/generated/prisma/client';
import { purgeAuthRecords } from '../src/modules/auth/auth-cleanup';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const { retention } = buildAuthConfig(process.env);
    const result = await purgeAuthRecords(prisma, new Date(), retention);
    console.log(
      `Purgados: ${result.sessions} sesiones, ${result.resetTokens} tokens de recuperación, ${result.throttles} contadores (retención ${retention.days} días).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
