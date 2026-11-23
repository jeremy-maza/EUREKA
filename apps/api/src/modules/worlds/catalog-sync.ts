import { PrismaClient } from '../../generated/prisma/client';
import { WorldDefinition } from './world.types';

/** Subconjunto de PrismaClient/TransactionClient que necesita la sincronización. */
type CatalogDb = Pick<PrismaClient, 'world' | 'rule'>;

/**
 * Persiste (upsert idempotente) mundos y reglas desde las definiciones en código. Nunca borra: una regla que deja
 * de estar en el catálogo conserva su fila (la referencian intentos, estadísticas y reglas dominadas).
 * Los retos ya no se siembran: se generan por secuencia. Las filas de `challenges` del catálogo fijo original
 * quedan como histórico.
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
      update: { name: world.name, description: world.description, position: world.position, isEnabled: true },
    });

    for (const rule of world.rules) {
      const data = { type: rule.type, description: rule.description, config: rule.config as object };
      await db.rule.upsert({
        where: { worldId_key: { worldId: worldRow.id, key: rule.id } },
        create: { worldId: worldRow.id, key: rule.id, ...data },
        update: data,
      });
    }
  }
}
