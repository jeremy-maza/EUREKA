import { Injectable, NotFoundException } from '@nestjs/common';
import { ChallengeEngine, RuleEngine } from '../challenges';
import { PrismaService } from '../../prisma/prisma.service';
import { validateWorldDefinition } from './world-validator';
import { WorldDefinition } from './world.types';

/** Mundo cargado de la BD: definición para el motor + ids de fila para persistir. */
export interface LoadedWorld {
  id: string;
  isEnabled: boolean;
  definition: WorldDefinition;
  /** clave de regla → id de fila */
  ruleRowIds: ReadonlyMap<string, string>;
  /** clave de reto → id de fila */
  challengeRowIds: ReadonlyMap<string, string>;
}

/**
 * Carga los mundos desde PostgreSQL y los VALIDA con el mismo validador del catálogo
 * (incluida la resolubilidad de cada reto). El catálogo es de solo lectura en ejecución,
 * por lo que se cachea en memoria; cámbialo con `db:seed` y reinicia (o `clearCache()`).
 */
@Injectable()
export class WorldsRepository {
  private readonly bySlug = new Map<string, LoadedWorld>();
  private readonly byId = new Map<string, LoadedWorld>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleEngine: RuleEngine,
    private readonly challengeEngine: ChallengeEngine,
  ) {}

  clearCache(): void {
    this.bySlug.clear();
    this.byId.clear();
  }

  /** Mundos habilitados, por orden de presentación. */
  async listEnabled(): Promise<LoadedWorld[]> {
    const rows = await this.prisma.world.findMany({
      where: { isEnabled: true },
      orderBy: { position: 'asc' },
      select: { slug: true },
    });
    return Promise.all(rows.map((row) => this.getBySlug(row.slug)));
  }

  /** @throws NotFoundException si no existe o no está habilitado. */
  async getBySlug(slug: string): Promise<LoadedWorld> {
    const cached = this.bySlug.get(slug);
    if (cached) return this.assertEnabled(cached);
    const row = await this.prisma.world.findUnique({ where: { slug }, select: { id: true } });
    if (!row) throw new NotFoundException(`El mundo "${slug}" no existe.`);
    return this.assertEnabled(await this.load(row.id));
  }

  async getById(id: string): Promise<LoadedWorld> {
    return this.byId.get(id) ?? this.load(id);
  }

  private assertEnabled(world: LoadedWorld): LoadedWorld {
    if (!world.isEnabled)
      throw new NotFoundException(`El mundo "${world.definition.slug}" no está disponible.`);
    return world;
  }

  private async load(id: string): Promise<LoadedWorld> {
    const row = await this.prisma.world.findUniqueOrThrow({
      where: { id },
      include: {
        rules: true,
        challenges: { orderBy: { position: 'asc' }, include: { introducesRule: true } },
      },
    });

    const definition: WorldDefinition = {
      slug: row.slug,
      name: row.name,
      description: row.description ?? '',
      position: row.position,
      rules: row.rules
        .map((rule) => ({
          id: rule.key,
          type: rule.type,
          description: rule.description,
          config: rule.config as Record<string, unknown>,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      challenges: row.challenges.map((challenge) => ({
        id: challenge.key,
        position: challenge.position,
        expression: challenge.expression,
        expectedResult: challenge.expectedResult,
        introducesRuleId: challenge.introducesRule?.key ?? null,
        referenceSolution: challenge.referenceSolution,
      })),
    };

    // Nunca se sirve un mundo cuyos retos no sean resolubles con todas sus reglas.
    validateWorldDefinition(definition, {
      ruleEngine: this.ruleEngine,
      challengeEngine: this.challengeEngine,
    });

    const loaded: LoadedWorld = {
      id: row.id,
      isEnabled: row.isEnabled,
      definition,
      ruleRowIds: new Map(row.rules.map((rule) => [rule.key, rule.id])),
      challengeRowIds: new Map(row.challenges.map((challenge) => [challenge.key, challenge.id])),
    };
    this.bySlug.set(row.slug, loaded);
    this.byId.set(row.id, loaded);
    return loaded;
  }
}
