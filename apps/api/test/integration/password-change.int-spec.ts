import { UserRole } from '../../src/generated/prisma/client';
import { AuthSessionsService } from '../../src/modules/auth/sessions.service';
import { bearer, createUser, jtiOf, login, signIn } from '../helpers/auth-helpers';
import { createTestApp, PASSWORD, TestContext } from '../helpers/test-app';

const NEW_PASSWORD = 'una-clave-nueva-y-larga';

describe('Cambio de contraseña (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const change = (token: string, body: object) =>
    ctx.http().post('/api/auth/change-password').set(bearer(token)).send(body);
  const me = (token: string) => ctx.http().get('/api/users/me').set(bearer(token));

  it('cambia la contraseña: la nueva funciona, la antigua ya no, y no devuelve hashes', async () => {
    const { userId, token } = await signIn(ctx, 'ana@example.com');
    const before = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const res = await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
    expect(res.body).toEqual({ message: 'Contraseña actualizada. Inicia sesión de nuevo.' });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passwordHash|accessToken/);

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(after.passwordHash).not.toContain(NEW_PASSWORD);

    await login(ctx, 'ana@example.com', PASSWORD).expect(401);
    await login(ctx, 'ana@example.com', NEW_PASSWORD).expect(200);
  });

  it('revoca TODAS las sesiones del usuario (incluida la actual) y los tokens antiguos dejan de valer', async () => {
    const { userId, token } = await signIn(ctx, 'ana@example.com');
    const second = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
    const bea = await signIn(ctx, 'bea@example.com');

    await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);

    await me(token).expect(401); // la sesión usada para el cambio también
    await me(second).expect(401);
    await ctx.http().get('/api/worlds').set(bearer(token)).expect(401);
    await me(bea.token).expect(200); // otros usuarios no se ven afectados

    const rows = await ctx.prisma.authSession.findMany({ where: { userId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((s) => s.revokedAt && s.revocationReason === 'PASSWORD_CHANGED')).toBe(true);
  });

  it('tras el cambio hay que autenticarse de nuevo: el login con la nueva clave da una sesión que funciona', async () => {
    const { token } = await signIn(ctx, 'ana@example.com');
    await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
    const fresh = (await login(ctx, 'ana@example.com', NEW_PASSWORD).expect(200)).body.accessToken as string;
    expect(jtiOf(fresh)).not.toBe(jtiOf(token));
    await me(fresh).expect(200);
  });

  it('contraseña actual incorrecta → 403 sin cambiar nada ni revocar sesiones', async () => {
    const { userId, token } = await signIn(ctx, 'ana@example.com');
    const before = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const res = await change(token, { currentPassword: 'no-es-la-actual', newPassword: NEW_PASSWORD }).expect(
      403,
    );
    expect(res.body.message).toBe('La contraseña actual es incorrecta.');

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    await me(token).expect(200);
    await login(ctx, 'ana@example.com', PASSWORD).expect(200);
  });

  it('rechaza nuevas contraseñas inválidas (política) sin cambiar nada', async () => {
    const { userId, token } = await signIn(ctx, 'ana@example.com');
    const before = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;

    const cases: [string, RegExp][] = [
      ['corta', /8 characters/], // validación de DTO
      ['x'.repeat(129), /128 characters/],
      ['password123', /común/],
      ['ana@example.com', /correo/],
      ['aaaaaaaaaaaa', /predecible/],
    ];
    for (const [newPassword, message] of cases) {
      const res = await change(token, { currentPassword: PASSWORD, newPassword }).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(message);
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    }
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe(before);
    await me(token).expect(200);
  });

  it('rechaza una nueva contraseña idéntica a la actual', async () => {
    const { userId, token } = await signIn(ctx, 'ana@example.com');
    const before = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
    const res = await change(token, { currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
    expect(res.body.message).toBe('La nueva contraseña debe ser distinta de la actual.');
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe(before);
    await me(token).expect(200);
  });

  it('valida el cuerpo: campos obligatorios y extras rechazados', async () => {
    const { token } = await signIn(ctx, 'ana@example.com');
    await change(token, {}).expect(400);
    await change(token, { currentPassword: PASSWORD }).expect(400);
    await change(token, { newPassword: NEW_PASSWORD }).expect(400);
    await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, role: 'ADMIN' }).expect(400);
    await change(token, { currentPassword: 123, newPassword: NEW_PASSWORD }).expect(400);
  });

  it('exige autenticación', async () => {
    await ctx
      .http()
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('funciona para estudiantes, docentes y administradores', async () => {
    for (const role of [UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN]) {
      const email = `${role.toLowerCase()}@example.com`;
      const { token } = await signIn(ctx, email, { role });
      await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
      await login(ctx, email, NEW_PASSWORD).expect(200);
    }
  });

  it('un docente aprovisionado por un administrador establece su propia contraseña en su primer acceso', async () => {
    const admin = await signIn(ctx, 'admin@example.com', { role: UserRole.ADMIN });
    const temporary = 'clave-temporal-del-admin';
    await ctx
      .http()
      .post('/api/admin/teachers')
      .set(bearer(admin.token))
      .send({ email: 'profa@example.com', displayName: 'Profa', password: temporary })
      .expect(201);

    const first = (await login(ctx, 'profa@example.com', temporary).expect(200)).body.accessToken as string;
    await change(first, { currentPassword: temporary, newPassword: 'la-clave-propia-de-la-profa' }).expect(
      200,
    );

    await login(ctx, 'profa@example.com', temporary).expect(401); // el administrador ya no puede entrar con ella
    const own = (await login(ctx, 'profa@example.com', 'la-clave-propia-de-la-profa').expect(200)).body
      .accessToken as string;
    await ctx.http().get('/api/teacher/dashboard').set(bearer(own)).expect(200);
  });

  it('la política también se aplica al registro y al aprovisionamiento de docentes', async () => {
    await ctx
      .http()
      .post('/api/auth/register')
      .send({ email: 'x@example.com', displayName: 'X', password: 'password123' })
      .expect(400);
    const admin = await signIn(ctx, 'admin@example.com', { role: UserRole.ADMIN });
    await ctx
      .http()
      .post('/api/admin/teachers')
      .set(bearer(admin.token))
      .send({ email: 'y@example.com', displayName: 'Y', password: '12345678' })
      .expect(400);
  });

  it('un cambio invalida los enlaces de recuperación pendientes', async () => {
    const { userId, token } = await signIn(ctx, 'ana@example.com');
    await ctx.http().post('/api/auth/password/forgot').send({ email: 'ana@example.com' }).expect(202);
    const resetToken = ctx.mailer.lastTokenFor('ana@example.com')!;

    await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);

    const row = await ctx.prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
    expect(row.invalidatedAt).not.toBeNull();
    await ctx
      .http()
      .post('/api/auth/password/reset')
      .send({ token: resetToken, newPassword: 'otra-clave-distinta-1' })
      .expect(400);
  });

  describe('limitación de intentos con la contraseña actual', () => {
    it('bloquea tras 5 intentos fallidos (429 + Retry-After) aunque luego acierte; expira solo', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      for (let i = 0; i < 5; i++) {
        await change(token, { currentPassword: `incorrecta-${i}-xx`, newPassword: NEW_PASSWORD }).expect(403);
      }
      const blocked = await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(
        429,
      );
      expect(blocked.headers['retry-after']).toBe('60');
      expect(blocked.body.message).toBe('Demasiados intentos. Inténtalo de nuevo más tarde.');
      await me(token).expect(200); // el bloqueo no cierra la sesión

      ctx.clock.advanceSeconds(61);
      await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
    });

    it('un cambio correcto limpia el contador', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      for (let i = 0; i < 4; i++) {
        await change(token, { currentPassword: `incorrecta-${i}-xx`, newPassword: NEW_PASSWORD }).expect(403);
      }
      await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
      expect(await ctx.prisma.authThrottle.count({ where: { scope: 'PASSWORD_CHANGE_USER' } })).toBe(0);
    });
  });

  describe('concurrencia', () => {
    it('dos cambios simultáneos con la misma contraseña actual: solo uno prospera', async () => {
      const { userId, token } = await signIn(ctx, 'ana@example.com');
      const [a, b] = await Promise.all([
        change(token, { currentPassword: PASSWORD, newPassword: 'clave-ganadora-numero-uno' }),
        change(token, { currentPassword: PASSWORD, newPassword: 'clave-ganadora-numero-dos' }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(200);
      expect([401, 409]).toContain(statuses[1]); // sesión ya revocada (401) o hash cambiado (409)

      const winner = a.status === 200 ? 'clave-ganadora-numero-uno' : 'clave-ganadora-numero-dos';
      const loser = a.status === 200 ? 'clave-ganadora-numero-dos' : 'clave-ganadora-numero-uno';
      await login(ctx, 'ana@example.com', winner).expect(200);
      await login(ctx, 'ana@example.com', loser).expect(401);
      expect(await ctx.prisma.authSession.count({ where: { userId, revokedAt: null } })).toBe(1); // solo la del login de arriba
    });

    it('un login que verificó la clave anterior no puede crear una sesión después del cambio', async () => {
      const user = await createUser(ctx, 'ana@example.com');
      const stale = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const { token } = {
        token: (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string,
      };
      await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);

      // Simula el login "en vuelo": ya verificó la contraseña antigua y ahora intenta emitir la sesión.
      const issued = await ctx.app.get(AuthSessionsService).issue(stale);
      expect(issued).toBeNull();
      expect(await ctx.prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    });
  });

  describe('sin fugas en registros', () => {
    it('nunca escribe contraseñas ni hashes en la salida estándar', async () => {
      const writes: string[] = [];
      const spies = (['stdout', 'stderr'] as const).map((stream) =>
        jest.spyOn(process[stream], 'write').mockImplementation(((chunk: unknown) => {
          writes.push(String(chunk));
          return true;
        }) as never),
      );
      try {
        const { token } = await signIn(ctx, 'ana@example.com');
        await change(token, { currentPassword: 'no-es-la-actual', newPassword: NEW_PASSWORD }).expect(403);
        await change(token, { currentPassword: PASSWORD, newPassword: 'corta' }).expect(400);
        await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
      const output = writes.join('');
      for (const secret of [PASSWORD, NEW_PASSWORD, 'no-es-la-actual', 'scrypt$']) {
        expect(output).not.toContain(secret);
      }
    });
  });
});
