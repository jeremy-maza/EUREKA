import { Injectable, NotFoundException } from '@nestjs/common';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { WorldDefinition } from './world.types';
import { WorldCatalog } from './worlds.service';

/** Mundo listo para jugar: definición del catálogo (código) + ids de fila para persistir. */
export interface LoadedWorld {
  id: string;
  isEnabled: boolean;
  definition: WorldDefinition;
  /** clave de regla → id de fila */
  ruleRowIds: ReadonlyMap<string, string>;
}

/**
 * Combina el catálogo en código (reglas, sintaxis, configuración de secuencias y generación; validado al arrancar
 * en `WorldsModule`) con las filas de PostgreSQL (ids). Un mundo solo se sirve si está en el catálogo, está
 * habilitado en la BD y todas sus reglas tienen fila (si no, falta `npm run db:seed`). Se cachea en memoria.
 *
 * Los métodos aceptan el cliente transaccional del llamador: dentro de una transacción NUNCA se debe consultar con
 * el cliente raíz (con un pool pequeño se bloquearía esperando una conexión que la propia transacción retiene).
 */
@Injectable()
export class WorldsRepository {
  private readonly bySlug = new Map<string, LoadedWorld>();
  private readonly byId = new Map<string, LoadedWorld>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: WorldCatalog,
  ) {}

  clearCache(): void {
    this.bySlug.clear();
    this.byId.clear();
  }

  /** Mundos habilitados y presentes en el catálogo, por orden de presentación. */
  async listEnabled(db: DbClient | PrismaService = this.prisma): Promise<LoadedWorld[]> {
    const rows = await db.world.findMany({
      where: { isEnabled: true },
      orderBy: { position: 'asc' },
      select: { slug: true },
    });
    const playable = rows.filter((row) => this.catalog.find(row.slug) !== undefined);
    const loaded: LoadedWorld[] = [];
    for (const row of playable) loaded.push(await this.getBySlug(row.slug, db)); // en serie: un solo cliente
    return loaded;
  }

  /** @throws NotFoundException si no existe, no está en el catálogo o no está habilitado. */
  async getBySlug(slug: string, db: DbClient | PrismaService = this.prisma): Promise<LoadedWorld> {
    const cached = this.bySlug.get(slug);
    if (cached) return this.assertEnabled(cached);
    const row = await db.world.findUnique({ where: { slug }, select: { id: true } });
    if (!row || !this.catalog.find(slug)) throw new NotFoundException(`El mundo "${slug}" no existe.`);
    return this.assertEnabled(await this.load(row.id, db));
  }

  async getById(id: string, db: DbClient | PrismaService = this.prisma): Promise<LoadedWorld> {
    return this.byId.get(id) ?? this.load(id, db);
  }

  private assertEnabled(world: LoadedWorld): LoadedWorld {
    if (!world.isEnabled)
      throw new NotFoundException(`El mundo "${world.definition.slug}" no está disponible.`);
    return world;
  }

  private async load(id: string, db: DbClient | PrismaService): Promise<LoadedWorld> {
    const row = await db.world.findUniqueOrThrow({
      where: { id },
      include: { rules: { select: { id: true, key: true } } },
    });
    const definition = this.catalog.find(row.slug);
    if (!definition) throw new NotFoundException(`El mundo "${row.slug}" no existe.`);

    const ruleRowIds = new Map(row.rules.map((rule) => [rule.key, rule.id]));
    const missing = definition.rules.filter((rule) => !ruleRowIds.has(rule.id)).map((rule) => rule.id);
    if (missing.length > 0) {
      // Defecto de despliegue, no del jugador: el catálogo en código va por delante de la BD.
      throw new Error(
        `El mundo "${row.slug}" tiene reglas sin sembrar en la BD (${missing.join(', ')}). Ejecuta npm run db:seed.`,
      );
    }

    const loaded: LoadedWorld = { id: row.id, isEnabled: row.isEnabled, definition, ruleRowIds };
    this.bySlug.set(row.slug, loaded);
    this.byId.set(row.id, loaded);
    return loaded;
  }
}
