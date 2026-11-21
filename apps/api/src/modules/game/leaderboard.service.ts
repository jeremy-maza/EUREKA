import { Injectable } from '@nestjs/common';
import { GroupStatus, MembershipStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorldsRepository } from '../worlds';
import { LeaderboardDto, LeaderboardEntryDto } from './dto/game.dto';

/**
 * Clasificación por puntos de un mundo, acotada a los **compañeros de grupo** del jugador (membresía ACTIVE en
 * grupos ACTIVE). Quien no pertenece a ningún grupo solo se ve a sí mismo. Solo expone nombre y puntos
 * (nunca ids ni correos de otras personas). Lee `StudentWorldProgress.totalPoints`, la misma fuente que `/progress`.
 */
@Injectable()
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly worlds: WorldsRepository,
  ) {}

  async getLeaderboard(userId: string, worldSlug: string, limit: number): Promise<LeaderboardDto> {
    const world = await this.worlds.getBySlug(worldSlug);

    const myGroups = await this.prisma.groupMembership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE, group: { status: GroupStatus.ACTIVE } },
      select: { groupId: true },
    });
    const peerIds = new Set<string>([userId]);
    if (myGroups.length > 0) {
      const peers = await this.prisma.groupMembership.findMany({
        where: {
          groupId: { in: myGroups.map((membership) => membership.groupId) },
          status: MembershipStatus.ACTIVE,
          user: { role: 'STUDENT' },
        },
        select: { userId: true },
      });
      peers.forEach((peer) => peerIds.add(peer.userId));
    }

    const people = await this.prisma.user.findMany({
      where: { id: { in: [...peerIds] } },
      select: {
        id: true,
        displayName: true,
        worldProgress: { where: { worldId: world.id }, select: { totalPoints: true } },
      },
    });

    const ranked = people
      .map((person) => ({
        id: person.id,
        displayName: person.displayName,
        points: person.worldProgress[0]?.totalPoints ?? 0,
      }))
      .sort(
        (a, b) =>
          b.points - a.points || a.displayName.localeCompare(b.displayName, 'es') || (a.id < b.id ? -1 : 1),
      );

    const entries: LeaderboardEntryDto[] = ranked.map((person) => ({
      // Posición de competición: los empates comparten lugar.
      rank: 1 + ranked.filter((other) => other.points > person.points).length,
      displayName: person.displayName,
      points: person.points,
      isCurrentUser: person.id === userId,
    }));

    return {
      worldSlug,
      scope: myGroups.length > 0 ? 'GROUPS' : 'SELF',
      participants: entries.length,
      entries: entries.slice(0, limit),
      me: entries.find((entry) => entry.isCurrentUser) as LeaderboardEntryDto,
    };
  }
}
