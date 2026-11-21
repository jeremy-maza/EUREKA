import { UserRole } from '../../src/generated/prisma/client';
import { purgeAuthRecords } from '../../src/modules/auth/auth-cleanup';
import { TokenService } from '../../src/modules/auth/token.service';
import {
  bearer,
  createUser,
  jtiOf,
  login,
  randomSessionId,
  signedToken,
  signIn,
} from '../helpers/auth-helpers';
import { createTestApp, PASSWORD, TestContext } from '../helpers/test-app';

describe('Sesiones JWT revocables (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const me = (token: string) => ctx.http().get('/api/users/me').set(bearer(token));
  const sessions = (token: string, query = '') =>
    ctx.http().get(`/api/auth/sessions${query}`).set(bearer(token));

  describe('creación', () => {
    it('cada login crea una sesión cuyo id es el jti del token; el JWT no se guarda', async () => {
      const { userId, token } = await signIn(ctx, 'ana@example.com', {
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (test)',
      });
      const jti = jtiOf(token);
      const row = await ctx.prisma.authSession.findUniqueOrThrow({ where: { id: jti } });
      expect(row).toMatchObject({
        userId,
        revokedAt: null,
        revocationReason: null,
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (test)',
      });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(3600 * 1000);

      // El esquema no tiene dónde guardar el token y ninguna columna lo contiene.
      const columns = await ctx.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'auth_sessions'`;
      expect(columns.map((c) => c.column_name)).not.toEqual(
        expect.arrayContaining(['token', 'accessToken', 'jwt']),
      );
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('dos logins crean dos sesiones distintas con tokens distintos', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      const second = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
      expect(jtiOf(second)).not.toBe(jtiOf(token));
      expect(await ctx.prisma.authSession.count()).toBe(2);
      await me(token).expect(200);
      await me(second).expect(200);
    });

    it('un login fallido no crea sesión', async () => {
      await createUser(ctx, 'ana@example.com');
      await login(ctx, 'ana@example.com', 'incorrecta-123').expect(401);
      expect(await ctx.prisma.authSession.count()).toBe(0);
    });

    it('el rol del token no se usa: manda el de la BD (sin cambios respecto a antes)', async () => {
      const { userId, token } = await signIn(ctx, 'ana@example.com');
      await ctx.prisma.user.update({ where: { id: userId }, data: { role: UserRole.TEACHER } });
      await ctx.http().get('/api/teacher/groups').set(bearer(token)).expect(200);
    });
  });

  describe('listado', () => {
    it('lista solo mis sesiones vigentes, marca la actual y no expone el token ni el hash', async () => {
      const { userId, token } = await signIn(ctx, 'ana@example.com', { userAgent: 'Navegador A' });
      const other = (await login(ctx, 'ana@example.com', PASSWORD, { userAgent: 'Navegador B' }).expect(200))
        .body.accessToken as string;

      const res = await sessions(token).expect(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.nextCursor).toBeNull();
      const byId = Object.fromEntries(res.body.items.map((s: { id: string }) => [s.id, s]));
      expect(byId[jtiOf(token)]).toMatchObject({ current: true, status: 'ACTIVE', userAgent: 'Navegador A' });
      expect(byId[jtiOf(other)]).toMatchObject({
        current: false,
        status: 'ACTIVE',
        userAgent: 'Navegador B',
      });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(token);
      expect(raw).not.toMatch(/passwordHash|scrypt|accessToken/);
      expect(raw).not.toContain(userId);
    });

    it('por defecto oculta las revocadas; status=ALL conserva el historial con su motivo', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      const second = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
      await ctx.http().post('/api/auth/logout').set(bearer(second)).expect(204);

      expect((await sessions(token).expect(200)).body.items).toHaveLength(1);
      const all = (await sessions(token, '?status=ALL').expect(200)).body.items;
      expect(all).toHaveLength(2);
      expect(all.find((s: { id: string }) => s.id === jtiOf(second))).toMatchObject({
        status: 'REVOKED',
        revocationReason: 'LOGOUT',
      });
      await sessions(token, '?status=BOGUS').expect(400);
    });

    it('pagina con cursor', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      for (let i = 0; i < 2; i++) {
        ctx.clock.advanceSeconds(1);
        await login(ctx, 'ana@example.com', PASSWORD).expect(200);
      }

      const first = (await sessions(token, '?limit=2').expect(200)).body;
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      const next = (await sessions(token, `?limit=2&cursor=${first.nextCursor}`).expect(200)).body;
      expect(next.items).toHaveLength(1);
      expect(next.nextCursor).toBeNull();
      const ids = [...first.items, ...next.items].map((s: { id: string }) => s.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('una sesión caducada aparece como EXPIRED en el historial', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      ctx.clock.advanceSeconds(3500);
      const fresh = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
      ctx.clock.advanceSeconds(200); // la primera caduca (3700 s); la segunda sigue vigente
      const all = (await sessions(fresh, '?status=ALL').expect(200)).body.items;
      expect(all.find((s: { id: string }) => s.id === jtiOf(token)).status).toBe('EXPIRED');
      expect((await sessions(fresh).expect(200)).body.items).toHaveLength(1);
    });
  });

  describe('revocación individual', () => {
    it('DELETE /auth/sessions/:id revoca esa sesión (y solo esa) al instante', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      const other = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
      const otherId = jtiOf(other);

      await ctx.http().delete(`/api/auth/sessions/${otherId}`).set(bearer(token)).expect(204);
      await me(other).expect(401);
      await me(token).expect(200);

      const row = await ctx.prisma.authSession.findUniqueOrThrow({ where: { id: otherId } });
      expect(row.revokedAt).not.toBeNull();
      expect(row.revocationReason).toBe('SESSION_REVOKED');
    });

    it('es idempotente y conserva el primer motivo y la primera fecha', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      const other = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
      await ctx
        .http()
        .delete(`/api/auth/sessions/${jtiOf(other)}`)
        .set(bearer(token))
        .expect(204);
      const first = await ctx.prisma.authSession.findUniqueOrThrow({ where: { id: jtiOf(other) } });
      ctx.clock.advanceSeconds(30);
      await ctx
        .http()
        .delete(`/api/auth/sessions/${jtiOf(other)}`)
        .set(bearer(token))
        .expect(204);
      const second = await ctx.prisma.authSession.findUniqueOrThrow({ where: { id: jtiOf(other) } });
      expect(second.revokedAt).toEqual(first.revokedAt);
    });

    it('un id inexistente da 404 y uno mal formado 400', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      await ctx.http().delete(`/api/auth/sessions/${randomSessionId()}`).set(bearer(token)).expect(404);
      await ctx.http().delete('/api/auth/sessions/no-es-uuid').set(bearer(token)).expect(400);
    });

    it('puede revocar la propia sesión actual (equivale a cerrar sesión)', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      await ctx
        .http()
        .delete(`/api/auth/sessions/${jtiOf(token)}`)
        .set(bearer(token))
        .expect(204);
      await me(token).expect(401);
    });
  });

  describe('logout y logout-all', () => {
    it('logout revoca la sesión actual: el token revocado no se puede reutilizar, las demás siguen', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      const other = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;

      await ctx.http().post('/api/auth/logout').set(bearer(token)).expect(204);
      await me(token).expect(401);
      await ctx.http().get('/api/worlds').set(bearer(token)).expect(401);
      await ctx.http().post('/api/auth/logout').set(bearer(token)).expect(401); // replay
      await me(other).expect(200);

      const row = await ctx.prisma.authSession.findUniqueOrThrow({ where: { id: jtiOf(token) } });
      expect(row.revocationReason).toBe('LOGOUT');
    });

    it('logout-all revoca todas las sesiones vigentes del usuario, y solo las suyas', async () => {
      const ana = await signIn(ctx, 'ana@example.com');
      const ana2 = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
      const bea = await signIn(ctx, 'bea@example.com');

      const res = await ctx.http().post('/api/auth/logout-all').set(bearer(ana.token)).expect(200);
      expect(res.body).toEqual({ revokedSessions: 2 });
      await me(ana.token).expect(401);
      await me(ana2).expect(401);
      await me(bea.token).expect(200);

      const reasons = await ctx.prisma.authSession.findMany({ where: { userId: ana.userId } });
      expect(reasons.every((s) => s.revocationReason === 'LOGOUT_ALL' && s.revokedAt)).toBe(true);
    });

    it('un login posterior a logout-all crea una sesión nueva que funciona', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      await ctx.http().post('/api/auth/logout-all').set(bearer(token)).expect(200);
      const fresh = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
      await me(fresh).expect(200);
    });

    it('logout y logout-all exigen autenticación', async () => {
      await ctx.http().post('/api/auth/logout').expect(401);
      await ctx.http().post('/api/auth/logout-all').expect(401);
      await ctx.http().get('/api/auth/sessions').expect(401);
      await ctx.http().delete(`/api/auth/sessions/${randomSessionId()}`).expect(401);
    });
  });

  describe('rechazo de tokens', () => {
    it('rechaza un token firmado y vigente cuya sesión no existe', async () => {
      const { userId } = await signIn(ctx, 'ana@example.com');
      const forged = ctx.app
        .get(TokenService)
        .issue({ sub: userId, role: UserRole.STUDENT, jti: randomSessionId() });
      const res = await me(forged.accessToken).expect(401);
      expect(res.body.message).toBe('Sesión no válida o revocada.');
    });

    it('rechaza un jti que no es un UUID (401, nunca 500)', async () => {
      const { userId } = await signIn(ctx, 'ana@example.com');
      const token = ctx.app
        .get(TokenService)
        .issue({ sub: userId, role: UserRole.STUDENT, jti: "x'; DROP TABLE users;--" }).accessToken;
      await me(token).expect(401);
      expect(await ctx.prisma.user.count()).toBe(1);
    });

    it('rechaza un token anterior a las sesiones (sin jti) aunque la firma sea válida', async () => {
      const { userId } = await signIn(ctx, 'ana@example.com');
      const now = Math.floor(ctx.clock.now().getTime() / 1000);
      const legacy = signedToken({ sub: userId, role: 'STUDENT', iat: now, exp: now + 3600 });
      await me(legacy).expect(401);
    });

    it('rechaza una sesión de otro usuario usada con el sub de otra cuenta', async () => {
      const ana = await signIn(ctx, 'ana@example.com');
      const bea = await signIn(ctx, 'bea@example.com');
      const mixed = ctx.app
        .get(TokenService)
        .issue({ sub: bea.userId, role: UserRole.STUDENT, jti: jtiOf(ana.token) });
      await me(mixed.accessToken).expect(401);
      await me(ana.token).expect(200);
    });

    it('rechaza una sesión caducada en BD aunque el JWT siga vigente', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      await me(token).expect(200);
      await ctx.prisma.authSession.update({
        where: { id: jtiOf(token) },
        data: {
          expiresAt: new Date(ctx.clock.now().getTime() - 1000),
          createdAt: new Date(ctx.clock.now().getTime() - 5000),
        },
      });
      await me(token).expect(401);
    });

    it('rechaza un JWT caducado (reloj del servidor) y una sesión caducada con el mismo mensaje genérico de token', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      ctx.clock.advanceSeconds(3601);
      await me(token).expect(401);
    });

    it('un token revocado no vuelve a funcionar aunque pase el tiempo ni se reutilice en otros endpoints', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      await ctx.http().post('/api/auth/logout').set(bearer(token)).expect(204);
      for (const path of ['/users/me', '/worlds', '/progress', '/auth/sessions']) {
        await ctx.http().get(`/api${path}`).set(bearer(token)).expect(401);
      }
    });

    it('la revocación afecta también a los endpoints de docente y administrador', async () => {
      const teacher = await signIn(ctx, 'profe@example.com', { role: UserRole.TEACHER });
      const admin = await signIn(ctx, 'admin@example.com', { role: UserRole.ADMIN });
      await ctx.http().get('/api/teacher/dashboard').set(bearer(teacher.token)).expect(200);
      await ctx.http().get('/api/admin/groups').set(bearer(admin.token)).expect(200);

      await ctx.http().post('/api/auth/logout').set(bearer(teacher.token)).expect(204);
      await ctx.http().post('/api/auth/logout').set(bearer(admin.token)).expect(204);
      await ctx.http().get('/api/teacher/dashboard').set(bearer(teacher.token)).expect(401);
      await ctx.http().get('/api/admin/groups').set(bearer(admin.token)).expect(401);
    });

    it('las restricciones de rol siguen intactas con sesiones válidas', async () => {
      const student = await signIn(ctx, 'ana@example.com');
      await ctx.http().get('/api/teacher/dashboard').set(bearer(student.token)).expect(403);
      await ctx.http().get('/api/admin/groups').set(bearer(student.token)).expect(403);
    });
  });

  describe('aislamiento entre usuarios', () => {
    it('un usuario no ve ni revoca las sesiones de otro (404 uniforme)', async () => {
      const ana = await signIn(ctx, 'ana@example.com');
      const bea = await signIn(ctx, 'bea@example.com');

      const list = (await sessions(ana.token, '?status=ALL').expect(200)).body.items;
      expect(list.map((s: { id: string }) => s.id)).toEqual([jtiOf(ana.token)]);

      await ctx
        .http()
        .delete(`/api/auth/sessions/${jtiOf(bea.token)}`)
        .set(bearer(ana.token))
        .expect(404);
      await me(bea.token).expect(200); // sigue viva
      const row = await ctx.prisma.authSession.findUniqueOrThrow({ where: { id: jtiOf(bea.token) } });
      expect(row.revokedAt).toBeNull();
    });

    it('un administrador tampoco accede a las sesiones privadas de otros', async () => {
      const admin = await signIn(ctx, 'admin@example.com', { role: UserRole.ADMIN });
      const teacher = await signIn(ctx, 'profe@example.com', { role: UserRole.TEACHER });
      const student = await signIn(ctx, 'ana@example.com');

      const own = (await sessions(admin.token, '?status=ALL').expect(200)).body.items;
      expect(own.map((s: { id: string }) => s.id)).toEqual([jtiOf(admin.token)]);

      for (const victim of [teacher, student]) {
        await ctx
          .http()
          .delete(`/api/auth/sessions/${jtiOf(victim.token)}`)
          .set(bearer(admin.token))
          .expect(404);
        await me(victim.token).expect(200);
      }
      // No existe ninguna ruta que reciba un userId.
      await ctx
        .http()
        .get(`/api/auth/sessions?userId=${student.userId}`)
        .set(bearer(admin.token))
        .expect(400);
      await ctx.http().get(`/api/users/${student.userId}/sessions`).set(bearer(admin.token)).expect(404);
    });

    it('logout-all de un usuario no afecta a los demás', async () => {
      const ana = await signIn(ctx, 'ana@example.com');
      const profe = await signIn(ctx, 'profe@example.com', { role: UserRole.TEACHER });
      await ctx.http().post('/api/auth/logout-all').set(bearer(ana.token)).expect(200);
      await me(profe.token).expect(200);
    });
  });

  describe('mantenimiento', () => {
    it('purga solo lo caducado hace más de la retención; conserva historial reciente y sesiones vigentes', async () => {
      const user = await createUser(ctx, 'ana@example.com');
      const now = ctx.clock.now();
      const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
      const row = (expiresAt: Date, extra: object = {}) => ({
        userId: user.id,
        createdAt: new Date(expiresAt.getTime() - 3_600_000),
        expiresAt,
        ...extra,
      });
      const old = await ctx.prisma.authSession.create({
        data: row(days(-40), { revokedAt: days(-41), revocationReason: 'LOGOUT' }),
      });
      const recentRevoked = await ctx.prisma.authSession.create({
        data: row(days(-2), { revokedAt: days(-2), revocationReason: 'LOGOUT_ALL' }),
      });
      const active = await ctx.prisma.authSession.create({ data: row(days(1)) });

      await ctx.prisma.passwordResetToken.createMany({
        data: [
          {
            userId: user.id,
            tokenHash: 'old',
            createdAt: days(-41),
            expiresAt: days(-40),
            consumedAt: days(-40),
          },
          {
            userId: user.id,
            tokenHash: 'recent',
            createdAt: days(-3),
            expiresAt: days(-2),
            consumedAt: days(-2),
          },
        ],
      });
      await ctx.prisma.authThrottle.createMany({
        data: [
          {
            scope: 'LOGIN_IP',
            key: 'stale',
            attempts: 2,
            windowStartedAt: days(-3),
            lastAttemptAt: days(-3),
          },
          { scope: 'LOGIN_IP', key: 'fresh', attempts: 2, windowStartedAt: now, lastAttemptAt: now },
          {
            scope: 'LOGIN_IP',
            key: 'still-locked',
            attempts: 0,
            windowStartedAt: days(-3),
            lastAttemptAt: days(-3),
            lockedUntil: days(1),
          },
        ],
      });

      const result = await purgeAuthRecords(ctx.prisma, now, { days: 30, cleanupIntervalMinutes: 0 });
      expect(result).toEqual({ sessions: 1, resetTokens: 1, throttles: 1 });

      const remaining = (await ctx.prisma.authSession.findMany()).map((s) => s.id).sort();
      expect(remaining).toEqual([recentRevoked.id, active.id].sort());
      expect(remaining).not.toContain(old.id);
      expect((await ctx.prisma.passwordResetToken.findMany()).map((t) => t.tokenHash)).toEqual(['recent']);
      expect((await ctx.prisma.authThrottle.findMany()).map((t) => t.key).sort()).toEqual([
        'fresh',
        'still-locked',
      ]);

      // Idempotente.
      expect(await purgeAuthRecords(ctx.prisma, now, { days: 30, cleanupIntervalMinutes: 0 })).toEqual({
        sessions: 0,
        resetTokens: 0,
        throttles: 0,
      });
    });
  });
});
