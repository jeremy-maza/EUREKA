import { WorldDefinition } from './world.types';

/**
 * Registro en memoria de mundos del catálogo. La fuente de verdad es el código (`catalog/`); las tablas
 * `worlds`/`rules` se rellenan con `npm run db:seed` para que intentos y estadísticas puedan referenciarlas.
 */
export class WorldCatalog {
  private readonly bySlug: ReadonlyMap<string, WorldDefinition>;

  constructor(worlds: readonly WorldDefinition[]) {
    this.bySlug = new Map(worlds.map((world) => [world.slug, world]));
  }

  list(): WorldDefinition[] {
    return [...this.bySlug.values()].sort((a, b) => a.position - b.position);
  }

  find(slug: string): WorldDefinition | undefined {
    return this.bySlug.get(slug);
  }

  /** @throws Error si el mundo no existe. */
  get(slug: string): WorldDefinition {
    const world = this.bySlug.get(slug);
    if (!world) throw new Error(`Mundo desconocido: "${slug}".`);
    return world;
  }
}
