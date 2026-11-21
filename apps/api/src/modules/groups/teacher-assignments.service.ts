import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthenticatedUser, Clock, cursorArgs, toPage } from '../../common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ListAssignmentsQueryDto,
  ListTeacherGroupsQueryDto,
  TeacherAssignmentDto,
  TeacherGroupAssignmentPageDto,
} from './dto/group.dto';
import { GroupAccessService } from './group-access.service';
import {
  GROUP_WITH_COUNTS,
  PERSON_SELECT,
  toTeacherAssignmentDto,
  toTeacherGroupAssignmentDto,
} from './groups.mappers';

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Asignaciones docente ↔ grupo. SOLO las operan administradores (los controladores exigen `@Roles(ADMIN)` y
 * los métodos de escritura reciben al actor administrador). Un docente nunca puede asignarse ni retirarse.
 * Retirar NO borra: marca la asignación como REVOKED y conserva quién y cuándo (historial).
 */
@Injectable()
export class TeacherAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly clock: Clock,
  ) {}

  async assign(admin: AuthenticatedUser, groupId: string, teacherId: string): Promise<TeacherAssignmentDto> {
    await this.access.requireWritable(admin, groupId);
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { ...PERSON_SELECT, role: true },
    });
    if (!teacher) throw new NotFoundException('Docente no encontrado.');
    if (teacher.role !== UserRole.TEACHER) {
      throw new UnprocessableEntityException('El usuario indicado no tiene rol de docente.');
    }

    try {
      // Sin `include`: el camino de error esperado (duplicado) debe ser una única sentencia simple.
      const row = await this.prisma.teacherGroupAssignment.create({
        data: { groupId, teacherId, assignedById: admin.id },
      });
      return toTeacherAssignmentDto({ ...row, teacher });
    } catch (error) {
      // Índice único parcial (teacherId, groupId) WHERE status = 'ACTIVE'.
      if (isUniqueViolation(error)) throw new ConflictException('El docente ya está asignado a este grupo.');
      throw error;
    }
  }

  async revoke(admin: AuthenticatedUser, groupId: string, teacherId: string): Promise<void> {
    await this.access.requireReadable(admin, groupId);
    const { count } = await this.prisma.teacherGroupAssignment.updateMany({
      where: { groupId, teacherId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: this.clock.now(), revokedById: admin.id },
    });
    if (count === 0) throw new NotFoundException('El docente no tiene una asignación activa en este grupo.');
  }

  /** Docentes del grupo (administración). Por defecto solo asignaciones activas; `ALL` incluye el historial. */
  async listForGroup(
    admin: AuthenticatedUser,
    groupId: string,
    query: ListAssignmentsQueryDto,
  ): Promise<TeacherAssignmentDto[]> {
    await this.access.requireReadable(admin, groupId);
    const status = query.status ?? 'ACTIVE';
    const rows = await this.prisma.teacherGroupAssignment.findMany({
      where: { groupId, ...(status === 'ALL' ? {} : { status }) },
      orderBy: { id: 'asc' },
      include: { teacher: { select: PERSON_SELECT } },
    });
    return rows.map(toTeacherAssignmentDto);
  }

  /** Grupos asignados a un docente concreto (administración), paginado. */
  async listGroupsOfTeacher(
    teacherId: string,
    query: ListTeacherGroupsQueryDto,
  ): Promise<TeacherGroupAssignmentPageDto> {
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId, role: UserRole.TEACHER },
      select: { id: true },
    });
    if (!teacher) throw new NotFoundException('Docente no encontrado.');

    const status = query.status ?? 'ACTIVE';
    const rows = await this.prisma.teacherGroupAssignment.findMany({
      where: { teacherId, ...(status === 'ALL' ? {} : { status }) },
      orderBy: { id: 'desc' },
      include: { group: { include: GROUP_WITH_COUNTS } },
      ...cursorArgs(query),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toTeacherGroupAssignmentDto), nextCursor: page.nextCursor };
  }
}
