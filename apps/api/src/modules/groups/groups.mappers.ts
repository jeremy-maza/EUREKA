import { Group, GroupMembership, Prisma, TeacherGroupAssignment, User } from '../../generated/prisma/client';
import {
  GroupDto,
  GroupMemberDto,
  GroupTeacherDto,
  TeacherAssignmentDto,
  TeacherGroupAssignmentDto,
} from './dto/group.dto';

/** `include`/`select` común para obtener un grupo con sus contadores de miembros y docentes activos. */
export const GROUP_WITH_COUNTS = {
  _count: {
    select: {
      memberships: { where: { status: 'ACTIVE' } },
      teacherAssignments: { where: { status: 'ACTIVE' } },
    },
  },
} as const satisfies Prisma.GroupInclude;

export type GroupWithCounts = Prisma.GroupGetPayload<{ include: typeof GROUP_WITH_COUNTS }>;

/** Columnas mínimas de usuario expuestas (nunca `passwordHash`). */
export const PERSON_SELECT = { id: true, displayName: true, email: true } satisfies Prisma.UserSelect;
type Person = Pick<User, 'id' | 'displayName' | 'email'>;

export const toGroupDto = (group: GroupWithCounts): GroupDto => ({
  id: group.id,
  name: group.name,
  description: group.description,
  status: group.status,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
  deactivatedAt: group.deactivatedAt,
  activeStudentCount: group._count.memberships,
  activeTeacherCount: group._count.teacherAssignments,
});

export const toMemberDto = (row: GroupMembership & { user: Person }): GroupMemberDto => ({
  id: row.id,
  student: { id: row.user.id, displayName: row.user.displayName, email: row.user.email },
  status: row.status,
  joinedAt: row.joinedAt,
  removedAt: row.removedAt,
});

export const toTeacherAssignmentDto = (
  row: TeacherGroupAssignment & { teacher: Person },
): TeacherAssignmentDto => ({
  assignmentId: row.id,
  teacher: { id: row.teacher.id, displayName: row.teacher.displayName, email: row.teacher.email },
  status: row.status,
  assignedAt: row.assignedAt,
  revokedAt: row.revokedAt,
});

export const toGroupTeacherDto = (
  row: Pick<TeacherGroupAssignment, 'assignedAt'> & { teacher: Pick<User, 'id' | 'displayName'> },
): GroupTeacherDto => ({
  id: row.teacher.id,
  displayName: row.teacher.displayName,
  assignedAt: row.assignedAt,
});

export const toTeacherGroupAssignmentDto = (
  row: TeacherGroupAssignment & { group: GroupWithCounts },
): TeacherGroupAssignmentDto => ({
  assignmentId: row.id,
  status: row.status,
  assignedAt: row.assignedAt,
  revokedAt: row.revokedAt,
  group: toGroupDto(row.group),
});

export type { Group };
