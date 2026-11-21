import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common';
import { Group, GroupMembership, GroupStatus, Prisma, UserRole } from '../../generated/prisma/client';
import { DbClient, PrismaService } from '../../prisma/prisma.service';

type Db = DbClient | PrismaService;

/**
 * Predicado de autorización de un docente sobre grupos: asignación ACTIVE propia. Es la ÚNICA definición de
 * "grupo asignado": cualquier consulta de grupos de un docente debe incluirla en su `where`.
 */
export const assignedToTeacher = (teacherId: string): Prisma.GroupWhereInput => ({
  teacherAssignments: { some: { teacherId, status: 'ACTIVE' } },
});

export const GROUP_NOT_FOUND = 'Grupo no encontrado.';
export const STUDENT_NOT_IN_GROUP = 'El estudiante no pertenece a este grupo.';

/**
 * ÚNICO punto de autorización de recursos con alcance de grupo. Todo servicio que lea o modifique datos de
 * un grupo (o de sus estudiantes) debe pasar por aquí ANTES de consultar información sensible.
 *
 * Reglas:
 *  - Docente: solo accede a grupos donde tiene una asignación ACTIVE. Un grupo ajeno (exista o no) responde
 *    404 con el mismo mensaje, de modo que conocer un id no revela nada.
 *  - Administrador: accede a cualquier grupo (la gestión administrativa es global).
 *  - Cualquier otro rol: 403 (defensa en profundidad; `@Roles` ya lo bloquea en el controlador).
 *  - Un grupo INACTIVE es de solo lectura para los docentes: las escrituras responden 409.
 */
@Injectable()
export class GroupAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grupo accesible para el actor (lectura). @throws NotFoundException si no existe o no está asignado. */
  async requireReadable(actor: AuthenticatedUser, groupId: string, db: Db = this.prisma): Promise<Group> {
    if (actor.role === UserRole.ADMIN) {
      const group = await db.group.findUnique({ where: { id: groupId } });
      if (!group) throw new NotFoundException(GROUP_NOT_FOUND);
      return group;
    }
    if (actor.role === UserRole.TEACHER) {
      // Una sola consulta: el grupo solo se devuelve si existe una asignación activa de ESTE docente.
      const group = await db.group.findFirst({
        where: { id: groupId, ...assignedToTeacher(actor.id) },
      });
      if (!group) throw new NotFoundException(GROUP_NOT_FOUND);
      return group;
    }
    throw new ForbiddenException('No tienes permisos para esta operación.');
  }

  /** Como `requireReadable`, pero además exige un grupo ACTIVE (para modificar). */
  async requireWritable(actor: AuthenticatedUser, groupId: string, db: Db = this.prisma): Promise<Group> {
    const group = await this.requireReadable(actor, groupId, db);
    this.assertActive(group);
    return group;
  }

  assertActive(group: Pick<Group, 'status'>): void {
    if (group.status !== GroupStatus.ACTIVE) {
      throw new ConflictException('El grupo está desactivado: solo un administrador puede reactivarlo.');
    }
  }

  /**
   * Membresía ACTIVE del estudiante en un grupo YA autorizado. El acceso a los datos de un estudiante
   * termina cuando termina su pertenencia al grupo.
   */
  async requireActiveMember(
    groupId: string,
    studentId: string,
    db: Db = this.prisma,
  ): Promise<GroupMembership> {
    const membership = await db.groupMembership.findFirst({
      where: { groupId, userId: studentId, status: 'ACTIVE' },
    });
    if (!membership) throw new NotFoundException(STUDENT_NOT_IN_GROUP);
    return membership;
  }

  /** Ids de los estudiantes con membresía ACTIVE en un grupo YA autorizado. */
  async activeMemberIds(groupId: string, db: Db = this.prisma): Promise<string[]> {
    const rows = await db.groupMembership.findMany({
      where: { groupId, status: 'ACTIVE' },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }
}
