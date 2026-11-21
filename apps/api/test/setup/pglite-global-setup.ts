import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/**
 * Levanta un PostgreSQL real (PGlite/WASM) en memoria, aplica TODAS las migraciones SQL del repositorio
 * en orden y lo expone por TCP para que lo use Prisma exactamente como usaría un servidor normal.
 */
export default async function globalSetup(): Promise<void> {
  const db = new PGlite();
  const migrationsDir = join(__dirname, '../../prisma/migrations');
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) {
    await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'));
  }

  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 });
  await server.start();

  process.env.TEST_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
  (globalThis as Record<string, unknown>).__PGLITE__ = { db, server };
}
