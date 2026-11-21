import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../src/generated/prisma/client';
import { GroupAccessService } from '../../src/modules/groups';
import { provisionUser } from '../../src/modules/admin';
import { PasswordHasher } from '../../src/modules/auth';
import { UsersService } from '../../src/modules/users';
import { assignTeacher, enrollStudent, makeGroup } from '../helpers/factories';
import { createTestApp, PASSWORD, Player, TestContext } from '../helpers/test-app';

describe('Grupos, docentes y membresías (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;
  let admin: Player;
  let teacherA: Player;
  let teacherB: Player;
  let ana: Player;
  let bea: Player;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.reset();
    // Los usuarios se crean una vez (el hash scrypt es costoso a propósito); los grupos se limpian por prueba.
    admin = await Player.register(ctx, 'admin@example.com', UserRole.ADMIN);
    teacherA = await Player.register(ctx, 'profa@example.com', UserRole.TEACHER, 'Profa A');
    teacherB = await Player.register(ctx, 'profb@example.com', UserRole.TEACHER, 'Profe B');
    ana = await Player.register(ctx, 'ana@example.com', UserRole.STUDENT, 'Ana');
    bea = await Player.register(ctx, 'bea@example.com', UserRole.STUDENT, 'Bea');
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.prisma.$executeRawUnsafe('TRUNCATE TABLE groups CASCADE'));

  const createGroup = (body: object = { name: '5.º A' }) => admin.post('/admin/groups').send(body);

  describe('aprovisionamiento de docentes', () => {
    const teacherBody = (email: string) => ({ email, displayName: 'Profe Nuevo', password: PASSWORD });

    it('un administrador crea un docente: rol TEACHER, sin exponer la contraseña, y puede iniciar sesión', async () => {
      const res = await admin.post('/admin/teachers').send(teacherBody('  Nuevo@Example.com ')).expect(201);
      expect(res.body).toMatchObject({
        email: 'nuevo@example.com',
        role: 'TEACHER',
        displayName: 'Profe Nuevo',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt|hash/i);

      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'nuevo@example.com' } });
      expect(row.passwordHash.startsWith('scrypt$')).toBe(true);
      expect(row.passwordHash).not.toContain(PASSWORD);

      const login = await ctx
        .http()
        .post('/api/auth/login')
        .send({ email: 'nuevo@example.com', password: PASSWORD })
        .expect(200);
      await ctx
        .http()
        .get('/api/teacher/groups')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
    });

    it('no permite elegir el rol, duplicar el correo ni enviar datos inválidos', async () => {
      await admin
        .post('/admin/teachers')
        .send({ ...teacherBody('x@example.com'), role: 'ADMIN' })
        .expect(400);
      await admin.post('/admin/teachers').send(teacherBody('profa@example.com')).expect(409);
      await admin.post('/admin/teachers').send(teacherBody('PROFA@example.com')).expect(409);
      await admin
        .post('/admin/teachers')
        .send({ ...teacherBody('no-es-correo') })
        .expect(400);
      await admin
        .post('/admin/teachers')
        .send({ ...teacherBody('y@example.com'), password: 'corta' })
        .expect(400);
      expect(
        await ctx.prisma.user.count({ where: { email: { in: ['x@example.com', 'y@example.com'] } } }),
      ).toBe(0);
    });

    it('estudiantes y docentes no pueden crear docentes; sin token → 401', async () => {
      await ana.post('/admin/teachers').send(teacherBody('s@example.com')).expect(403);
      await teacherA.post('/admin/teachers').send(teacherBody('t@example.com')).expect(403);
      await ctx.http().post('/api/admin/teachers').send(teacherBody('u@example.com')).expect(401);
      expect(
        await ctx.prisma.user.count({
          where: { email: { in: ['s@', 't@', 'u@'].map((p) => `${p}example.com`) } },
        }),
      ).toBe(0);
    });

    it('el registro público solo crea estudiantes y rechaza roles privilegiados', async () => {
      for (const role of ['TEACHER', 'ADMIN']) {
        await ctx
          .http()
          .post('/api/auth/register')
          .send({ email: `${role}@example.com`, displayName: 'X', password: PASSWORD, role })
          .expect(400);
      }
      const ok = await ctx
        .http()
        .post('/api/auth/register')
        .send({ email: 'registrada@example.com', displayName: 'R', password: PASSWORD })
        .expect(201);
      expect(ok.body.role).toBe('STUDENT');
    });

    it('lista solo docentes, con búsqueda y paginación; los estudiantes no acceden', async () => {
      const all = await admin.get('/admin/teachers').expect(200);
      const emails = all.body.items.map((u: { email: string }) => u.email);
      expect(emails).toEqual(expect.arrayContaining(['profa@example.com', 'profb@example.com']));
      expect(emails).not.toContain('ana@example.com');
      expect(emails).not.toContain('admin@example.com');
      expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|scrypt/);

      const page1 = await admin.get('/admin/teachers?limit=1').expect(200);
      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.nextCursor).toEqual(expect.any(String));
      const page2 = await admin.get(`/admin/teachers?limit=1&cursor=${page1.body.nextCursor}`).expect(200);
      expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

      const found = await admin.get('/admin/teachers?search=PROFB').expect(200);
      expect(found.body.items.map((u: { email: string }) => u.email)).toEqual(['profb@example.com']);
      await ana.get('/admin/teachers').expect(403);
    });

    it('el script operativo crea administradores y NO promociona cuentas existentes', async () => {
      const users = new UsersService(ctx.prisma);
      const created = await provisionUser(users, new PasswordHasher(), {
        email: 'root@example.com',
        displayName: 'Root',
        password: 'una-clave-de-administrador',
        role: UserRole.ADMIN,
      });
      expect(created).toMatchObject({ role: 'ADMIN', email: 'root@example.com' });
      expect(JSON.stringify(created)).not.toMatch(/passwordHash|scrypt/);

      const login = await ctx
        .http()
        .post('/api/auth/login')
        .send({ email: 'root@example.com', password: 'una-clave-de-administrador' })
        .expect(200);
      await ctx
        .http()
        .get('/api/admin/groups')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      await expect(
        provisionUser(users, new PasswordHasher(), {
          email: 'ana@example.com', // estudiante existente
          displayName: 'Ana',
          password: 'una-clave-de-administrador',
          role: UserRole.ADMIN,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'ana@example.com' } })).role).toBe(
        'STUDENT',
      );
    });
  });

  describe('gestión de grupos (administrador)', () => {
    it('crea, consulta, lista y actualiza un grupo', async () => {
      const created = await createGroup({ name: '  5.º A ', description: 'Mates' }).expect(201);
      expect(created.body).toMatchObject({
        name: '5.º A',
        description: 'Mates',
        status: 'ACTIVE',
        deactivatedAt: null,
        activeStudentCount: 0,
        activeTeacherCount: 0,
      });
      expect(created.body.id).toEqual(expect.any(String));

      const id = created.body.id;
      expect((await admin.get(`/admin/groups/${id}`).expect(200)).body.name).toBe('5.º A');

      const patched = await admin
        .patch(`/admin/groups/${id}`)
        .send({ name: '5.º B', description: null })
        .expect(200);
      expect(patched.body).toMatchObject({ name: '5.º B', description: null });
      expect(new Date(patched.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.body.updatedAt).getTime(),
      );

      await admin.patch(`/admin/groups/${id}`).send({}).expect(400);
      await admin.patch(`/admin/groups/${id}`).send({ status: 'INACTIVE' }).expect(400);
      await admin.patch(`/admin/groups/${id}`).send({ name: '' }).expect(400);
    });

    it('crea el grupo con docentes en una única transacción (todo o nada)', async () => {
      const ok = await createGroup({
        name: 'Con docentes',
        teacherIds: [teacherA.userId, teacherB.userId],
      }).expect(201);
      expect(ok.body.activeTeacherCount).toBe(2);
      const rows = await ctx.prisma.teacherGroupAssignment.findMany({ where: { groupId: ok.body.id } });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.assignedById === admin.userId)).toBe(true);

      // Un estudiante entre los ids invalida TODA la creación: no queda ningún grupo huérfano.
      const before = await ctx.prisma.group.count();
      await createGroup({ name: 'Falla', teacherIds: [teacherA.userId, ana.userId] }).expect(400);
      await createGroup({
        name: 'Falla 2',
        teacherIds: [teacherA.userId, '0198a5c0-0000-7000-8000-000000000001'],
      }).expect(400);
      expect(await ctx.prisma.group.count()).toBe(before);
    });

    it('lista paginada por cursor y filtrada por estado', async () => {
      for (const name of ['C', 'A', 'B']) await createGroup({ name }).expect(201);
      const inactive = await createGroup({ name: 'D' }).expect(201);
      await admin.post(`/admin/groups/${inactive.body.id}/deactivate`).expect(200);

      const all = await admin.get('/admin/groups').expect(200);
      expect(all.body.items.map((g: { name: string }) => g.name)).toEqual(['A', 'B', 'C', 'D']);
      const active = await admin.get('/admin/groups?status=ACTIVE').expect(200);
      expect(active.body.items.map((g: { name: string }) => g.name)).toEqual(['A', 'B', 'C']);
      const off = await admin.get('/admin/groups?status=INACTIVE').expect(200);
      expect(off.body.items.map((g: { name: string }) => g.name)).toEqual(['D']);

      const names: string[] = [];
      let cursor = '';
      for (let i = 0; i < 5; i++) {
        const page = await admin.get(`/admin/groups?limit=3${cursor}`).expect(200);
        names.push(...page.body.items.map((g: { name: string }) => g.name));
        if (!page.body.nextCursor) break;
        cursor = `&cursor=${page.body.nextCursor}`;
      }
      expect(names).toEqual(['A', 'B', 'C', 'D']);
      await admin.get('/admin/groups?status=ZZZ').expect(400);
      await admin.get('/admin/groups?limit=0').expect(400);
    });

    it('desactivar conserva el historial, bloquea escrituras y se puede revertir', async () => {
      const group = await makeGroup(ctx.prisma, 'Histórico');
      await assignTeacher(ctx.prisma, group.id, teacherA.userId);
      await enrollStudent(ctx.prisma, group.id, ana.userId);

      const off = await admin.post(`/admin/groups/${group.id}/deactivate`).expect(200);
      expect(off.body).toMatchObject({ status: 'INACTIVE', activeStudentCount: 1, activeTeacherCount: 1 });
      expect(off.body.deactivatedAt).toEqual(expect.any(String));
      await admin.post(`/admin/groups/${group.id}/deactivate`).expect(409);

      // Sigue siendo legible para su docente (solo lectura) pero no modificable.
      await teacherA.get(`/teacher/groups/${group.id}`).expect(200);
      await teacherA.get(`/teacher/groups/${group.id}/students`).expect(200);
      await teacherA.patch(`/teacher/groups/${group.id}`).send({ name: 'x' }).expect(409);
      await teacherA.post(`/teacher/groups/${group.id}/students`).send({ studentId: bea.userId }).expect(409);
      await teacherA.delete(`/teacher/groups/${group.id}/students/${ana.userId}`).expect(409);
      await admin.post(`/admin/groups/${group.id}/teachers`).send({ teacherId: teacherB.userId }).expect(409);
      // No aparece en la lista por defecto del docente pero sí con el filtro.
      expect((await teacherA.get('/teacher/groups').expect(200)).body.items).toHaveLength(0);
      expect((await teacherA.get('/teacher/groups?status=INACTIVE').expect(200)).body.items).toHaveLength(1);

      const on = await admin.post(`/admin/groups/${group.id}/reactivate`).expect(200);
      expect(on.body).toMatchObject({ status: 'ACTIVE', deactivatedAt: null });
      await admin.post(`/admin/groups/${group.id}/reactivate`).expect(409);
      await teacherA.patch(`/teacher/groups/${group.id}`).send({ name: 'Renombrado' }).expect(200);
    });

    it('responde 404 ante grupos inexistentes y 400 ante ids mal formados; no hay borrado de grupos', async () => {
      const missing = '0198a5c0-0000-7000-8000-000000000001';
      await admin.get(`/admin/groups/${missing}`).expect(404);
      await admin.patch(`/admin/groups/${missing}`).send({ name: 'x' }).expect(404);
      await admin.post(`/admin/groups/${missing}/deactivate`).expect(404);
      await admin.get('/admin/groups/no-es-uuid').expect(400);
      const group = await makeGroup(ctx.prisma);
      await admin.delete(`/admin/groups/${group.id}`).expect(404);
      expect(await ctx.prisma.group.count()).toBe(1);
    });
  });

  describe('asignaciones docentes', () => {
    it('asigna, rechaza duplicados y registra quién asignó', async () => {
      const group = await makeGroup(ctx.prisma);
      const res = await admin
        .post(`/admin/groups/${group.id}/teachers`)
        .send({ teacherId: teacherA.userId })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        revokedAt: null,
        teacher: { id: teacherA.userId, email: 'profa@example.com' },
      });
      await admin.post(`/admin/groups/${group.id}/teachers`).send({ teacherId: teacherA.userId }).expect(409);
      expect(await ctx.prisma.teacherGroupAssignment.count({ where: { groupId: group.id } })).toBe(1);
      const row = await ctx.prisma.teacherGroupAssignment.findFirstOrThrow({ where: { groupId: group.id } });
      expect(row.assignedById).toBe(admin.userId);

      // Un grupo puede tener varios docentes y un docente varios grupos.
      await admin.post(`/admin/groups/${group.id}/teachers`).send({ teacherId: teacherB.userId }).expect(201);
      const other = await makeGroup(ctx.prisma, 'Otro');
      await admin.post(`/admin/groups/${other.id}/teachers`).send({ teacherId: teacherA.userId }).expect(201);
      expect((await admin.get(`/admin/groups/${group.id}/teachers`).expect(200)).body).toHaveLength(2);
      const groupsOfA = await admin.get(`/admin/teachers/${teacherA.userId}/groups`).expect(200);
      expect(groupsOfA.body.items.map((i: { group: { id: string } }) => i.group.id).sort()).toEqual(
        [group.id, other.id].sort(),
      );
    });

    it('valida el destino: solo usuarios con rol docente y existentes', async () => {
      const group = await makeGroup(ctx.prisma);
      await admin.post(`/admin/groups/${group.id}/teachers`).send({ teacherId: ana.userId }).expect(422);
      await admin.post(`/admin/groups/${group.id}/teachers`).send({ teacherId: admin.userId }).expect(422);
      await admin
        .post(`/admin/groups/${group.id}/teachers`)
        .send({ teacherId: '0198a5c0-0000-7000-8000-000000000001' })
        .expect(404);
      await admin.post(`/admin/groups/${group.id}/teachers`).send({ teacherId: 'x' }).expect(400);
      await admin
        .post(`/admin/groups/${group.id}/teachers`)
        .send({ teacherId: teacherA.userId, role: 'ADMIN' })
        .expect(400);
      expect(await ctx.prisma.teacherGroupAssignment.count()).toBe(0);
    });

    it('retirar NO borra: conserva el historial y permite reasignar', async () => {
      const group = await makeGroup(ctx.prisma);
      await assignTeacher(ctx.prisma, group.id, teacherA.userId);
      await teacherA.get(`/teacher/groups/${group.id}`).expect(200);

      await admin.delete(`/admin/groups/${group.id}/teachers/${teacherA.userId}`).expect(204);
      await admin.delete(`/admin/groups/${group.id}/teachers/${teacherA.userId}`).expect(404);
      // Pierde el acceso de inmediato.
      await teacherA.get(`/teacher/groups/${group.id}`).expect(404);

      const history = await admin.get(`/admin/groups/${group.id}/teachers?status=ALL`).expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0]).toMatchObject({ status: 'REVOKED', revokedAt: expect.any(String) });
      expect((await admin.get(`/admin/groups/${group.id}/teachers`).expect(200)).body).toHaveLength(0);
      const row = await ctx.prisma.teacherGroupAssignment.findFirstOrThrow({ where: { groupId: group.id } });
      expect(row.revokedById).toBe(admin.userId);

      // Reasignar crea una fila nueva: la histórica se conserva.
      await admin.post(`/admin/groups/${group.id}/teachers`).send({ teacherId: teacherA.userId }).expect(201);
      expect(await ctx.prisma.teacherGroupAssignment.count({ where: { groupId: group.id } })).toBe(2);
      await teacherA.get(`/teacher/groups/${group.id}`).expect(200);
      const revoked = await admin.get(`/admin/teachers/${teacherA.userId}/groups?status=REVOKED`).expect(200);
      expect(revoked.body.items).toHaveLength(1);
    });

    it('un docente no puede asignarse, retirar a otro ni ver la administración', async () => {
      const group = await makeGroup(ctx.prisma);
      await assignTeacher(ctx.prisma, group.id, teacherB.userId);
      await teacherA
        .post(`/admin/groups/${group.id}/teachers`)
        .send({ teacherId: teacherA.userId })
        .expect(403);
      await teacherA.delete(`/admin/groups/${group.id}/teachers/${teacherB.userId}`).expect(403);
      await teacherB.delete(`/admin/groups/${group.id}/teachers/${teacherB.userId}`).expect(403);
      await teacherA.get(`/admin/groups/${group.id}/teachers`).expect(403);
      await ana.post(`/admin/groups/${group.id}/teachers`).send({ teacherId: ana.userId }).expect(403);
      expect(
        await ctx.prisma.teacherGroupAssignment.count({ where: { groupId: group.id, status: 'ACTIVE' } }),
      ).toBe(1);
      expect(await ctx.prisma.teacherGroupAssignment.count({ where: { teacherId: teacherA.userId } })).toBe(
        0,
      );
    });

    // Las carreras (peticiones simultáneas) las resuelve el índice único parcial de la BD, que se ejercita aquí
    // de forma secuencial: PGlite comparte una sola sesión y no permite paralelismo real con errores.
    it('la base de datos impide duplicados activos y roles incorrectos aunque se salte la aplicación', async () => {
      const group = await makeGroup(ctx.prisma);
      await assignTeacher(ctx.prisma, group.id, teacherA.userId);
      await expect(assignTeacher(ctx.prisma, group.id, teacherA.userId)).rejects.toThrow();
      await expect(assignTeacher(ctx.prisma, group.id, ana.userId)).rejects.toThrow(); // trigger de rol
      await enrollStudent(ctx.prisma, group.id, ana.userId);
      await expect(enrollStudent(ctx.prisma, group.id, ana.userId)).rejects.toThrow();
      await expect(enrollStudent(ctx.prisma, group.id, teacherA.userId)).rejects.toThrow(); // trigger de rol
      // CHECK de coherencia estado ↔ fecha.
      await expect(
        ctx.prisma.groupMembership.updateMany({ where: { groupId: group.id }, data: { status: 'REMOVED' } }),
      ).rejects.toThrow();
    });
  });

  describe('membresías de estudiantes (docente)', () => {
    let groupA: { id: string };
    let groupB: { id: string };

    beforeEach(async () => {
      groupA = await makeGroup(ctx.prisma, 'Grupo A');
      groupB = await makeGroup(ctx.prisma, 'Grupo B');
      await assignTeacher(ctx.prisma, groupA.id, teacherA.userId);
      await assignTeacher(ctx.prisma, groupB.id, teacherB.userId);
    });

    it('agrega por id y por correo, y rechaza duplicados', async () => {
      const byId = await teacherA
        .post(`/teacher/groups/${groupA.id}/students`)
        .send({ studentId: ana.userId })
        .expect(201);
      expect(byId.body).toMatchObject({
        status: 'ACTIVE',
        removedAt: null,
        student: { id: ana.userId, email: 'ana@example.com' },
      });
      expect(JSON.stringify(byId.body)).not.toMatch(/passwordHash|scrypt/);
      const byEmail = await teacherA
        .post(`/teacher/groups/${groupA.id}/students`)
        .send({ email: ' BEA@example.com ' })
        .expect(201);
      expect(byEmail.body.student.id).toBe(bea.userId);

      await teacherA
        .post(`/teacher/groups/${groupA.id}/students`)
        .send({ studentId: ana.userId })
        .expect(409);
      await teacherA
        .post(`/teacher/groups/${groupA.id}/students`)
        .send({ email: 'ana@example.com' })
        .expect(409);
      expect(await ctx.prisma.groupMembership.count({ where: { groupId: groupA.id } })).toBe(2);

      const row = await ctx.prisma.groupMembership.findFirstOrThrow({
        where: { groupId: groupA.id, userId: ana.userId },
      });
      expect(row.addedById).toBe(teacherA.userId);
    });

    it('valida la entrada: exactamente un identificador, existente y con rol de estudiante', async () => {
      const url = `/teacher/groups/${groupA.id}/students`;
      await teacherA.post(url).send({}).expect(400);
      await teacherA.post(url).send({ studentId: ana.userId, email: 'ana@example.com' }).expect(400);
      await teacherA.post(url).send({ studentId: 'x' }).expect(400);
      await teacherA.post(url).send({ studentId: ana.userId, role: 'TEACHER' }).expect(400);
      await teacherA.post(url).send({ studentId: '0198a5c0-0000-7000-8000-000000000001' }).expect(404);
      await teacherA.post(url).send({ email: 'nadie@example.com' }).expect(404);
      // Rol inválido: docentes y administradores nunca entran como miembros.
      await teacherA.post(url).send({ studentId: teacherB.userId }).expect(422);
      await teacherA.post(url).send({ email: 'admin@example.com' }).expect(422);
      expect(await ctx.prisma.groupMembership.count()).toBe(0);
    });

    it('un estudiante puede estar en varios grupos y los ve en /users/me/groups con sus docentes', async () => {
      await assignTeacher(ctx.prisma, groupA.id, teacherB.userId); // grupo A con dos docentes
      await teacherA
        .post(`/teacher/groups/${groupA.id}/students`)
        .send({ studentId: ana.userId })
        .expect(201);
      await teacherB
        .post(`/teacher/groups/${groupB.id}/students`)
        .send({ studentId: ana.userId })
        .expect(201);
      await teacherB
        .post(`/teacher/groups/${groupB.id}/students`)
        .send({ studentId: bea.userId })
        .expect(201);

      const mine = await ana.get('/users/me/groups').expect(200);
      expect(mine.body.map((g: { name: string }) => g.name)).toEqual(['Grupo A', 'Grupo B']);
      expect(mine.body[0].teachers.map((t: { displayName: string }) => t.displayName).sort()).toEqual([
        'Profa A',
        'Profe B',
      ]);
      expect(JSON.stringify(mine.body)).not.toMatch(/@example\.com/); // los correos de los docentes no se exponen
      expect((await bea.get('/users/me/groups').expect(200)).body).toHaveLength(1);

      // Retirarla de un grupo no afecta al otro.
      await teacherA.delete(`/teacher/groups/${groupA.id}/students/${ana.userId}`).expect(204);
      expect(
        (await ana.get('/users/me/groups').expect(200)).body.map((g: { name: string }) => g.name),
      ).toEqual(['Grupo B']);
    });

    it('retirar conserva el historial; reincorporar crea una membresía nueva', async () => {
      await teacherA
        .post(`/teacher/groups/${groupA.id}/students`)
        .send({ studentId: ana.userId })
        .expect(201);
      await teacherA.delete(`/teacher/groups/${groupA.id}/students/${ana.userId}`).expect(204);
      await teacherA.delete(`/teacher/groups/${groupA.id}/students/${ana.userId}`).expect(404);

      expect(
        (await teacherA.get(`/teacher/groups/${groupA.id}/students`).expect(200)).body.items,
      ).toHaveLength(0);
      const history = await teacherA.get(`/teacher/groups/${groupA.id}/students?status=REMOVED`).expect(200);
      expect(history.body.items[0]).toMatchObject({ status: 'REMOVED', removedAt: expect.any(String) });
      const row = await ctx.prisma.groupMembership.findFirstOrThrow({ where: { groupId: groupA.id } });
      expect(row.removedById).toBe(teacherA.userId);

      await teacherA
        .post(`/teacher/groups/${groupA.id}/students`)
        .send({ studentId: ana.userId })
        .expect(201);
      expect(await ctx.prisma.groupMembership.count({ where: { groupId: groupA.id } })).toBe(2);
      expect(
        (await teacherA.get(`/teacher/groups/${groupA.id}/students?status=ALL`).expect(200)).body.items,
      ).toHaveLength(2);
      expect((await teacherA.get(`/teacher/groups/${groupA.id}`).expect(200)).body.activeStudentCount).toBe(
        1,
      );
    });

    it('lista ordenada por nombre, con búsqueda y paginación por cursor', async () => {
      const extra = await Promise.all(
        ['Carla', 'Aitor', 'Berta'].map((n) =>
          Player.register(ctx, `${n.toLowerCase()}@example.com`, UserRole.STUDENT, n),
        ),
      );
      for (const s of extra) await enrollStudent(ctx.prisma, groupA.id, s.userId);

      const all = await teacherA.get(`/teacher/groups/${groupA.id}/students`).expect(200);
      expect(all.body.items.map((m: { student: { displayName: string } }) => m.student.displayName)).toEqual([
        'Aitor',
        'Berta',
        'Carla',
      ]);

      const seen: string[] = [];
      let cursor = '';
      for (let i = 0; i < 4; i++) {
        const page = await teacherA.get(`/teacher/groups/${groupA.id}/students?limit=2${cursor}`).expect(200);
        seen.push(...page.body.items.map((m: { student: { displayName: string } }) => m.student.displayName));
        if (!page.body.nextCursor) break;
        cursor = `&cursor=${page.body.nextCursor}`;
      }
      expect(seen).toEqual(['Aitor', 'Berta', 'Carla']);

      const found = await teacherA.get(`/teacher/groups/${groupA.id}/students?search=BERT`).expect(200);
      expect(found.body.items).toHaveLength(1);
      expect(found.body.items[0].student.displayName).toBe('Berta');
    });

    it('un docente no puede leer, agregar ni retirar estudiantes de grupos que no gestiona (404 sin fugas)', async () => {
      await enrollStudent(ctx.prisma, groupB.id, bea.userId);

      // Teacher A usa un id de grupo válido que pertenece a B.
      await teacherA.get(`/teacher/groups/${groupB.id}`).expect(404);
      await teacherA.get(`/teacher/groups/${groupB.id}/students`).expect(404);
      await teacherA.patch(`/teacher/groups/${groupB.id}`).send({ name: 'Secuestrado' }).expect(404);
      await teacherA
        .post(`/teacher/groups/${groupB.id}/students`)
        .send({ studentId: ana.userId })
        .expect(404);
      await teacherA.delete(`/teacher/groups/${groupB.id}/students/${bea.userId}`).expect(404);

      // La respuesta es idéntica a la de un grupo que no existe: no revela su existencia.
      const foreign = await teacherA.get(`/teacher/groups/${groupB.id}`).expect(404);
      const missing = await teacherA.get('/teacher/groups/0198a5c0-0000-7000-8000-000000000001').expect(404);
      expect(foreign.body.message).toBe(missing.body.message);

      expect((await ctx.prisma.group.findUniqueOrThrow({ where: { id: groupB.id } })).name).toBe('Grupo B');
      expect(
        await ctx.prisma.groupMembership.count({ where: { groupId: groupB.id, status: 'ACTIVE' } }),
      ).toBe(1);
      expect(await ctx.prisma.groupMembership.count({ where: { userId: ana.userId } })).toBe(0);
      // Y su lista de grupos solo contiene los propios.
      expect(
        (await teacherA.get('/teacher/groups').expect(200)).body.items.map((g: { id: string }) => g.id),
      ).toEqual([groupA.id]);
    });

    it('el docente edita nombre y descripción de su grupo pero no su estado', async () => {
      const res = await teacherA
        .patch(`/teacher/groups/${groupA.id}`)
        .send({ name: 'Nuevo nombre', description: 'Desc' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Nuevo nombre', description: 'Desc', status: 'ACTIVE' });
      await teacherA.patch(`/teacher/groups/${groupA.id}`).send({ status: 'INACTIVE' }).expect(400);
      await teacherA.post(`/teacher/groups/${groupA.id}/deactivate`).expect(404); // ruta inexistente para docentes
      const detail = await teacherA.get(`/teacher/groups/${groupA.id}`).expect(200);
      expect(detail.body.teachers).toEqual([
        expect.objectContaining({ id: teacherA.userId, displayName: 'Profa A' }),
      ]);
      expect(JSON.stringify(detail.body)).not.toMatch(/@example\.com/);
    });

    it('el administrador también puede gestionar membresías (p. ej. grupos sin docente)', async () => {
      const orphan = await makeGroup(ctx.prisma, 'Sin docente');
      await admin.post(`/admin/groups/${orphan.id}/students`).send({ studentId: ana.userId }).expect(201);
      expect((await admin.get(`/admin/groups/${orphan.id}/students`).expect(200)).body.items).toHaveLength(1);
      await admin.delete(`/admin/groups/${orphan.id}/students/${ana.userId}`).expect(204);
      await ana.get(`/admin/groups/${orphan.id}/students`).expect(403);
    });
  });

  describe('autorización a nivel de servicio (GroupAccessService)', () => {
    it('aplica las reglas por rol, asignación y estado del grupo', async () => {
      const access = ctx.app.get(GroupAccessService);
      const group = await makeGroup(ctx.prisma);
      await assignTeacher(ctx.prisma, group.id, teacherA.userId);
      await enrollStudent(ctx.prisma, group.id, ana.userId);
      const as = (p: Player, role: UserRole) => ({ id: p.userId, email: '', role });

      await expect(access.requireReadable(as(teacherA, 'TEACHER'), group.id)).resolves.toMatchObject({
        id: group.id,
      });
      await expect(access.requireReadable(as(admin, 'ADMIN'), group.id)).resolves.toMatchObject({
        id: group.id,
      });
      await expect(access.requireReadable(as(teacherB, 'TEACHER'), group.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(access.requireReadable(as(ana, 'STUDENT'), group.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        access.requireReadable(as(teacherA, 'TEACHER'), '0198a5c0-0000-7000-8000-000000000001'),
      ).rejects.toBeInstanceOf(NotFoundException);

      await expect(access.requireActiveMember(group.id, ana.userId)).resolves.toMatchObject({
        userId: ana.userId,
      });
      await expect(access.requireActiveMember(group.id, bea.userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await access.activeMemberIds(group.id)).toEqual([ana.userId]);

      // Asignación revocada ⇒ acceso denegado de inmediato.
      await ctx.prisma.teacherGroupAssignment.updateMany({
        where: { groupId: group.id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await expect(access.requireReadable(as(teacherA, 'TEACHER'), group.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      // Grupo desactivado ⇒ legible pero no escribible.
      await assignTeacher(ctx.prisma, group.id, teacherA.userId);
      await ctx.prisma.group.update({
        where: { id: group.id },
        data: { status: 'INACTIVE', deactivatedAt: new Date() },
      });
      await expect(access.requireReadable(as(teacherA, 'TEACHER'), group.id)).resolves.toBeDefined();
      await expect(access.requireWritable(as(teacherA, 'TEACHER'), group.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
