import { Group } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Siembra directa en BD (rápida) para preparar escenarios; las pruebas de los endpoints usan HTTP. */
export const makeGroup = (
  prisma: PrismaService,
  name = 'Grupo de prueba',
  description?: string,
): Promise<Group> => prisma.group.create({ data: { name, description } });

export const assignTeacher = (prisma: PrismaService, groupId: string, teacherId: string) =>
  prisma.teacherGroupAssignment.create({ data: { groupId, teacherId } });

export const enrollStudent = (prisma: PrismaService, groupId: string, userId: string) =>
  prisma.groupMembership.create({ data: { groupId, userId } });
