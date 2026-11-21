import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Se ejecuta con cwd = apps/api (vía scripts npm). Soporta .env local o el de la raíz del monorepo.
loadEnv({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Puede ser undefined para `prisma generate`; los comandos de migración sí exigen DATABASE_URL.
    url: process.env['DATABASE_URL'],
  },
});
