/**
 * CLI de los datos de demostración (solo desarrollo). Ver `docs/demo.md`.
 *
 *   npm run db:seed:demo     # (re)crea las cuentas y escenarios demo: borra antes SOLO los datos demo anteriores
 *   npm run db:demo:reset    # elimina las cuentas demo y todo lo que cuelga de ellas
 *
 * Requisito previo: `npm run db:seed` (catálogo del Mundo 1). Se niega a ejecutarse con NODE_ENV=production.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client';
import { assertDemoAllowed, DEMO_EMAIL_DOMAIN, resetDemoData, seedDemoData } from './demo/demo-fixtures';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

async function main(): Promise<void> {
  assertDemoAllowed();
  const resetOnly = process.argv.includes('--reset');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    if (resetOnly) {
      const summary = await resetDemoData(prisma);
      console.log(
        `Datos demo eliminados: ${summary.users} cuentas, ${summary.groups} grupos` +
          (summary.groupsKept
            ? ` (${summary.groupsKept} grupo(s) conservado(s) por tener miembros reales)`
            : '') +
          `. Solo se tocan correos @${DEMO_EMAIL_DOMAIN}.`,
      );
      return;
    }

    const result = await seedDemoData(prisma);
    console.log(`Datos demo creados (se reemplazaron ${result.reset.users} cuentas demo anteriores).`);
    console.log(`Contraseña de todas las cuentas demo: ${result.password}\n`);
    for (const account of result.accounts) {
      console.log(`  [${account.scenario}] ${account.email}\n      ${account.description}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
