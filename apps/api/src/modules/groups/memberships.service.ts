import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthenticatedUser, Clock, cursorArgs, toPage } from '../../common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeEmail } from '../users';
import {
  AddStudentDto,
  GroupMemberDto,
  GroupMemberPageDto,
  ListStudentsQueryDto,
  StudentGroupDto,
} from './dto/group.dto';
import { GroupAccessService, STUDENT_NOT_IN_GROUP } from './group-access.service';
import { PERSON_SELECT, toMemberDto } from './groups.mappers';

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Membresías estudiante ↔ grupo. Las gestionan docentes asignados (y administradores). La autorización va
 * SIEMPRE antes de leer o escribir. Retirar a un estudiante no borra la fila: pasa a REMOVED (historial) y
 * una nueva incorporación crea una fila nueva.
 *
 * Un docente solo cambia la pertenencia; no existe ninguna operación aquí (ni en el módulo) que modifique
 * roles, credenciales, puntos, intentos o reglas acumuladas.
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly clock: Clock,
  ) {}

  async list(
    actor: AuthenticatedUser,
    groupId: string,
    query: ListStudentsQueryDto,
  ): Promise<GroupMemberPageDto> {
    await this.access.requireReadable(actor, groupId);
    const status = query.status ?? 'ACTIVE';
    const rows = await this.prisma.groupMembership.findMany({
      where: {
        groupId,
        ...(status === 'ALL' ? {} : { status }),
        ...(query.search
          ? {
              user: {
                OR: [
                  { displayName: { contains: query.search, mode: 'insensitive' } },
                  { email: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
      include: { user: { select: PERSON_SELECT } },
      ...cursorArgs(query),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toMemberDto), nextCursor: page.nextCursor };
  }

  async add(actor: AuthenticatedUser, groupId: string, dto: AddStudentDto): Promise<GroupMemberDto> {
    if (Boolean(dto.studentId) === Boolean(dto.email)) {
      throw new BadRequestException('Indica exactamente uno de `studentId` o `email`.');
    }
    await this.access.requireWritable(actor, groupId);

    const student = await this.prisma.user.findUnique({
      where: dto.studentId ? { id: dto.studentId } : { email: normalizeEmail(dto.email!) },
      select: { ...PERSON_SELECT, role: true },
    });
    if (!student) throw new NotFoundException('Estudiante no encontrado.');
    if (student.role !== UserRole.STUDENT) {
      throw new UnprocessableEntityException('Solo se pueden agregar usuarios con rol de estudiante.');
    }

    try {
      // Sin `include`: el camino de error esperado (duplicado) debe ser una única sentencia simple.
      const row = await this.prisma.groupMembership.create({
        data: { groupId, userId: student.id, addedById: actor.id },
      });
      return toMemberDto({ ...row, user: student });
    } catch (error) {
      // Índice único parcial (userId, groupId) WHERE status = 'ACTIVE'.
      if (isUniqueViolation(error)) throw new ConflictException('El estudiante ya pertenece a este grupo.');
      throw error;
    }
  }

  async remove(actor: AuthenticatedUser, groupId: string, studentId: string): Promise<void> {
    await this.access.requireWritable(actor, groupId);
    const { count } = await this.prisma.groupMembership.updateMany({
      where: { groupId, userId: studentId, status: 'ACTIVE' },
      data: { status: 'REMOVED', removedAt: this.clock.now(), removedById: actor.id },
    });
    if (count === 0) throw new NotFoundException(STUDENT_NOT_IN_GROUP);
  }

  /** Grupos del propio estudiante (membresías activas) con los nombres de sus docentes. */
  async listForStudent(studentId: string): Promise<StudentGroupDto[]> {
    const rows = await this.prisma.groupMembership.findMany({
      where: { userId: studentId, status: 'ACTIVE' },
      orderBy: [{ group: { name: 'asc' } }, { id: 'asc' }],
      include: {
        group: {
          include: {
            teacherAssignments: {
              where: { status: 'ACTIVE' },
              orderBy: { id: 'asc' },
              select: { teacher: { select: { id: true, displayName: true } } },
            },
          },
        },
      },
    });
    return rows.map((row) => ({
      id: row.group.id,
      name: row.group.name,
      description: row.group.description,
      status: row.group.status,
      joinedAt: row.joinedAt,
      teachers: row.group.teacherAssignments.map((a) => a.teacher),
    }));
  }
}
