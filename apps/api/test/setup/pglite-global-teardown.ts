import type { PGlite } from '@electric-sql/pglite';
import type { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export default async function globalTeardown(): Promise<void> {
  const handle = (globalThis as Record<string, unknown>).__PGLITE__ as
    { db: PGlite; server: PGLiteSocketServer } | undefined;
  await handle?.server.stop();
  await handle?.db.close();
}
