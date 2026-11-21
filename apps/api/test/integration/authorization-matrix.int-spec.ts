import { UserRole } from '../../src/generated/prisma/client';
import { assignTeacher, enrollStudent, makeGroup } from '../helpers/factories';
import { createTestApp, Player, TestContext } from '../helpers/test-app';

type Actor = 'anonymous' | 'student' | 'teacher' | 'admin' | 'foreignTeacher';
type Method = 'get' | 'post' | 'patch' | 'delete';

interface Route {
  method: Method;
  path: string;
  /** Roles autorizados (de forma general). */
  roles: ('student' | 'teacher' | 'admin')[];
  /** Si la ruta es de un grupo concreto: un docente NO asignado debe recibir 404 (sin fugas). */
  groupScoped?: boolean;
  body?: object;
}

/**
 * Matriz completa de autorización. Cada fila se ejercita con cada actor. Solo se afirman las DENEGACIONES
 * (401/403/404): las respuestas de éxito y los efectos se cubren en las demás suites. Los guards se evalúan
 * antes que la validación, así que un cuerpo vacío no altera el resultado esperado de una denegación.
 */
describe('Matriz de autorización (HTTP)', () => {
  let ctx: TestContext;
  const players = {} as Record<Exclude<Actor, 'anonymous'>, Player>;
  let routes: Route[];
  let ids: { group: string; student: string; teacher: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.reset();
    players.admin = await Player.register(ctx, 'admin@example.com', UserRole.ADMIN);
    players.teacher = await Player.register(ctx, 'profa@example.com', UserRole.TEACHER);
    players.foreignTeacher = await Player.register(ctx, 'profb@example.com', UserRole.TEACHER);
    players.student = await Player.register(ctx, 'ana@example.com', UserRole.STUDENT);

    const group = await makeGroup(ctx.prisma, 'Grupo');
    await assignTeacher(ctx.prisma, group.id, players.teacher.userId);
    await enrollStudent(ctx.prisma, group.id, players.student.userId);
    ids = { group: group.id, student: players.student.userId, teacher: players.teacher.userId };

    const g = `/teacher/groups/${ids.group}`;
    const a = `/admin/groups/${ids.group}`;
    routes = [
      // Administración
      {
        method: 'post',
        path: '/admin/teachers',
        roles: ['admin'],
        body: { email: 'z@example.com', displayName: 'Z', password: 'una-clave-larga' },
      },
      { method: 'get', path: '/admin/teachers', roles: ['admin'] },
      { method: 'get', path: `/admin/teachers/${ids.teacher}/groups`, roles: ['admin'] },
      { method: 'post', path: '/admin/groups', roles: ['admin'], body: { name: 'X' } },
      { method: 'get', path: '/admin/groups', roles: ['admin'] },
      { method: 'get', path: a, roles: ['admin'] },
      { method: 'patch', path: a, roles: ['admin'], body: { name: 'X' } },
      { method: 'post', path: `${a}/deactivate`, roles: ['admin'] },
      { method: 'post', path: `${a}/reactivate`, roles: ['admin'] },
      { method: 'get', path: `${a}/teachers`, roles: ['admin'] },
      { method: 'post', path: `${a}/teachers`, roles: ['admin'], body: { teacherId: ids.teacher } },
      { method: 'delete', path: `${a}/teachers/${ids.teacher}`, roles: ['admin'] },
      { method: 'get', path: `${a}/students`, roles: ['admin'] },
      { method: 'post', path: `${a}/students`, roles: ['admin'], body: { studentId: ids.student } },
      { method: 'delete', path: `${a}/students/${ids.student}`, roles: ['admin'] },
      // Gestión de grupos por docentes
      { method: 'get', path: '/teacher/groups', roles: ['teacher'] },
      { method: 'get', path: g, roles: ['teacher'], groupScoped: true },
      { method: 'patch', path: g, roles: ['teacher'], groupScoped: true, body: { name: 'X' } },
      { method: 'get', path: `${g}/students`, roles: ['teacher'], groupScoped: true },
      {
        method: 'post',
        path: `${g}/students`,
        roles: ['teacher'],
        groupScoped: true,
        body: { studentId: ids.student },
      },
      { method: 'delete', path: `${g}/students/${ids.student}`, roles: ['teacher'], groupScoped: true },
      // Panel docente
      { method: 'get', path: '/teacher/dashboard', roles: ['teacher'] },
      { method: 'get', path: `${g}/dashboard`, roles: ['teacher'], groupScoped: true },
      { method: 'get', path: `${g}/dashboard/students`, roles: ['teacher'], groupScoped: true },
      { method: 'get', path: `${g}/statistics`, roles: ['teacher'], groupScoped: true },
      { method: 'get', path: `${g}/students/${ids.student}`, roles: ['teacher'], groupScoped: true },
      {
        method: 'get',
        path: `${g}/students/${ids.student}/statistics`,
        roles: ['teacher'],
        groupScoped: true,
      },
      { method: 'get', path: `${g}/students/${ids.student}/attempts`, roles: ['teacher'], groupScoped: true },
      // Información de grupos del estudiante
      { method: 'get', path: '/users/me/groups', roles: ['student'] },
    ];
  });
  afterAll(() => ctx.close());

  const send = (actor: Actor, route: Route) => {
    const req =
      actor === 'anonymous'
        ? ctx.http()[route.method](`/api${route.path}`)
        : players[actor][route.method](route.path);
    return route.body ? req.send(route.body) : req;
  };

  it('sin token: 401 en todas las rutas', async () => {
    for (const route of routes) {
      const res = await send('anonymous', route);
      expect([route.method, route.path, res.status]).toEqual([route.method, route.path, 401]);
    }
  });

  it.each(['student', 'teacher', 'admin'] as const)('rol %s: 403 en rutas de otros roles', async (actor) => {
    for (const route of routes.filter((r) => !r.roles.includes(actor))) {
      const res = await send(actor, route);
      expect([actor, route.method, route.path, res.status]).toEqual([actor, route.method, route.path, 403]);
    }
  });

  it('un docente NO asignado recibe 404 en toda ruta de un grupo ajeno (conozca o no los ids)', async () => {
    const scoped = routes.filter((r) => r.groupScoped);
    expect(scoped.length).toBeGreaterThanOrEqual(10);
    for (const route of scoped) {
      const res = await send('foreignTeacher', route);
      expect([route.method, route.path, res.status]).toEqual([route.method, route.path, 404]);
    }
    // Ningún intento de escritura tuvo efecto.
    expect((await ctx.prisma.group.findUniqueOrThrow({ where: { id: ids.group } })).name).toBe('Grupo');
    expect(await ctx.prisma.groupMembership.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect(await ctx.prisma.teacherGroupAssignment.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });

  it('los actores autorizados no reciben denegación en las lecturas', async () => {
    for (const route of routes.filter((r) => r.method === 'get')) {
      const actor = route.roles[0];
      const res = await send(actor, route);
      expect([actor, route.path, res.status]).toEqual([actor, route.path, 200]);
    }
  });

  it('un token válido de un usuario cuyo rol cambió usa el rol actual (no el del token)', async () => {
    const promoted = await Player.register(ctx, 'promo@example.com', UserRole.STUDENT);
    await promoted.get('/admin/groups').expect(403);
    await ctx.prisma.user.update({ where: { id: promoted.userId }, data: { role: 'ADMIN' } });
    await promoted.get('/admin/groups').expect(200); // el rol se recarga de la BD en cada petición
    await ctx.prisma.user.update({ where: { id: promoted.userId }, data: { role: 'STUDENT' } });
    await promoted.get('/admin/groups').expect(403);
  });
});
