import { WorldDefinition } from './world.types';

/**
 * Registro en memoria de mundos del catálogo (la fuente de verdad del MVP es código;
 * la tabla `worlds`/`rules`/`challenges` se rellena con `npm run db:seed`).
 */
export class WorldCatalog {
  private readonly bySlug: ReadonlyMap<string, WorldDefinition>;

  constructor(worlds: readonly WorldDefinition[]) {
    this.bySlug = new Map(worlds.map((world) => [world.slug, world]));
  }

  list(): WorldDefinition[] {
    return [...this.bySlug.values()].sort((a, b) => a.position - b.position);
  }

  /** @throws Error si el mundo no existe. */
  get(slug: string): WorldDefinition {
    const world = this.bySlug.get(slug);
    if (!world) throw new Error(`Mundo desconocido: "${slug}".`);
    return world;
  }
}
