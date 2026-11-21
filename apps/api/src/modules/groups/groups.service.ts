import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, Clock, cursorArgs, toPage } from '../../common';
import { GroupStatus, Prisma, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGroupDto,
  GroupDto,
  GroupPageDto,
  GroupStatusFilter,
  ListGroupsQueryDto,
  TeacherGroupDetailDto,
  UpdateGroupDto,
} from './dto/group.dto';
import { assignedToTeacher, GroupAccessService } from './group-access.service';
import { GROUP_WITH_COUNTS, PERSON_SELECT, toGroupDto, toGroupTeacherDto } from './groups.mappers';

const statusWhere = (filter: GroupStatusFilter): Prisma.GroupWhereInput =>
  filter === 'ALL' ? {} : { status: filter === 'ACTIVE' ? GroupStatus.ACTIVE : GroupStatus.INACTIVE };

/** Ciclo de vida de los grupos. Los grupos nunca se borran: se desactivan y conservan su historial. */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly clock: Clock,
  ) {}

  /**
   * Crea el grupo y, opcionalmente, asigna a sus docentes en la MISMA transacción
   * (o se crea todo o no se crea nada).
   */
  async create(admin: AuthenticatedUser, dto: CreateGroupDto): Promise<GroupDto> {
    const teacherIds = dto.teacherIds ?? [];
    return this.prisma.$transaction(async (tx) => {
      if (teacherIds.length > 0) {
        const teachers = await tx.user.findMany({
          where: { id: { in: teacherIds }, role: UserRole.TEACHER },
          select: { id: true },
        });
        if (teachers.length !== teacherIds.length) {
          throw new BadRequestException(
            'Todos los `teacherIds` deben ser usuarios existentes con rol docente.',
          );
        }
      }
      const group = await tx.group.create({
        data: {
          name: dto.name,
          description: dto.description || null,
          createdById: admin.id,
          teacherAssignments: {
            create: teacherIds.map((teacherId) => ({ teacherId, assignedById: admin.id })),
          },
        },
        include: GROUP_WITH_COUNTS,
      });
      return toGroupDto(group);
    });
  }

  /** Detalle de un grupo para el actor (administrador o docente asignado). */
  async get(actor: AuthenticatedUser, groupId: string): Promise<GroupDto> {
    await this.access.requireReadable(actor, groupId);
    return toGroupDto(await this.loadWithCounts(groupId));
  }

  /** Detalle para un docente: incluye a los docentes asignados (sin correo). */
  async getForTeacher(teacher: AuthenticatedUser, groupId: string): Promise<TeacherGroupDetailDto> {
    await this.access.requireReadable(teacher, groupId);
    const [group, assignments] = await Promise.all([
      this.loadWithCounts(groupId),
      this.prisma.teacherGroupAssignment.findMany({
        where: { groupId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        select: { assignedAt: true, teacher: { select: PERSON_SELECT } },
      }),
    ]);
    return { ...toGroupDto(group), teachers: assignments.map(toGroupTeacherDto) };
  }

  /** Todos los grupos (administración). Orden alfabético; filtro por estado (por defecto, todos). */
  async listAll(query: ListGroupsQueryDto): Promise<GroupPageDto> {
    const rows = await this.prisma.group.findMany({
      where: statusWhere(query.status ?? 'ALL'),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: GROUP_WITH_COUNTS,
      ...cursorArgs(query),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toGroupDto), nextCursor: page.nextCursor };
  }

  /** Solo los grupos con asignación ACTIVE del docente (por defecto, solo grupos activos). */
  async listForTeacher(teacher: AuthenticatedUser, query: ListGroupsQueryDto): Promise<GroupPageDto> {
    const rows = await this.prisma.group.findMany({
      where: {
        ...statusWhere(query.status ?? 'ACTIVE'),
        ...assignedToTeacher(teacher.id),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: GROUP_WITH_COUNTS,
      ...cursorArgs(query),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toGroupDto), nextCursor: page.nextCursor };
  }

  /** Un docente solo edita nombre y descripción de sus grupos activos; el estado es exclusivo del administrador. */
  async update(actor: AuthenticatedUser, groupId: string, dto: UpdateGroupDto): Promise<GroupDto> {
    if (dto.name === undefined && dto.description === undefined) {
      throw new BadRequestException('Indica al menos un campo a modificar (`name` o `description`).');
    }
    await this.access.requireWritable(actor, groupId);
    const group = await this.prisma.group.update({
      where: { id: groupId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
      },
      include: GROUP_WITH_COUNTS,
    });
    return toGroupDto(group);
  }

  /** Desactiva el grupo (409 si ya lo estaba). Conserva membresías y asignaciones como historial. */
  async deactivate(admin: AuthenticatedUser, groupId: string): Promise<GroupDto> {
    await this.access.requireReadable(admin, groupId);
    const { count } = await this.prisma.group.updateMany({
      where: { id: groupId, status: GroupStatus.ACTIVE },
      data: { status: GroupStatus.INACTIVE, deactivatedAt: this.clock.now() },
    });
    if (count === 0) throw new ConflictException('El grupo ya está desactivado.');
    return toGroupDto(await this.loadWithCounts(groupId));
  }

  async reactivate(admin: AuthenticatedUser, groupId: string): Promise<GroupDto> {
    await this.access.requireReadable(admin, groupId);
    const { count } = await this.prisma.group.updateMany({
      where: { id: groupId, status: GroupStatus.INACTIVE },
      data: { status: GroupStatus.ACTIVE, deactivatedAt: null },
    });
    if (count === 0) throw new ConflictException('El grupo ya está activo.');
    return toGroupDto(await this.loadWithCounts(groupId));
  }

  private async loadWithCounts(groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId }, include: GROUP_WITH_COUNTS });
    if (!group) throw new NotFoundException('Grupo no encontrado.');
    return group;
  }
}
