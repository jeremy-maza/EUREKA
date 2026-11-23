import { ForbiddenException, Injectable } from '@nestjs/common';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { ProgressionService } from '../progression';
import { LoadedWorld, WorldsRepository } from '../worlds';

export interface WorldUnlockStatus {
  unlocked: boolean;
  /** Mundo que hay que completar para desbloquearlo (`null` si ya está desbloqueado). */
  requirement: LoadedWorld | null;
}

/**
 * Desbloqueo de mundos: el primero (por posición) siempre está abierto; cada uno de los siguientes se abre cuando el
 * jugador completa al menos una secuencia del anterior (`completionsCount > 0`). Lo impone el servidor.
 */
@Injectable()
export class WorldUnlockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly worlds: WorldsRepository,
    private readonly progression: ProgressionService,
  ) {}

  async statusFor(
    userId: string,
    db: DbClient | PrismaService = this.prisma,
  ): Promise<Map<string, WorldUnlockStatus>> {
    const ordered = await this.worlds.listEnabled(db);
    const completions = await this.progression.completionsByWorld(
      userId,
      ordered.map((world) => world.id),
      db,
    );
    const status = new Map<string, WorldUnlockStatus>();
    ordered.forEach((world, index) => {
      const previous = index === 0 ? null : ordered[index - 1];
      const unlocked = previous === null || (completions.get(previous.id) ?? 0) > 0;
      status.set(world.id, { unlocked, requirement: unlocked ? null : previous });
    });
    return status;
  }

  async assertUnlocked(
    userId: string,
    world: LoadedWorld,
    db: DbClient | PrismaService = this.prisma,
  ): Promise<void> {
    const status = (await this.statusFor(userId, db)).get(world.id);
    if (status && !status.unlocked && status.requirement) {
      const { position, name } = status.requirement.definition;
      throw new ForbiddenException(`Completa el Mundo ${position} (${name}) para desbloquear este mundo.`);
    }
  }

  /** Mundo habilitado inmediatamente posterior (por posición), si existe. */
  async next(world: LoadedWorld, db: DbClient | PrismaService = this.prisma): Promise<LoadedWorld | null> {
    const ordered = await this.worlds.listEnabled(db);
    const index = ordered.findIndex((candidate) => candidate.id === world.id);
    return index >= 0 && index + 1 < ordered.length ? ordered[index + 1] : null;
  }
}
