import { createHash } from 'node:crypto';
import { UserRole } from '../../src/generated/prisma/client';
import { PasswordService } from '../../src/modules/auth/password.service';
import { Mailer } from '../../src/modules/mail';
import { bearer, createUser, login, signIn } from '../helpers/auth-helpers';
import { createTestApp, PASSWORD, TestContext } from '../helpers/test-app';

const NEW_PASSWORD = 'una-clave-nueva-y-larga';
const INVALID_MESSAGE = 'El enlace de recuperación no es válido o ha caducado.';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Recuperación de contraseña (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const forgot = (email: string, ip?: string) => {
    let req = ctx.http().post('/api/auth/password/forgot');
    if (ip) req = req.set('X-Forwarded-For', ip);
    return req.send({ email });
  };
  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    ctx.http().post('/api/auth/password/reset').send({ token, newPassword });
  /** Solicita la recuperación y espera a la entrega en segundo plano. */
  const requestToken = async (email: string): Promise<string> => {
    await forgot(email).expect(202);
    await ctx.app.get(PasswordService).drainPendingMail();
    const token = ctx.mailer.lastTokenFor(email);
    if (!token) throw new Error('No se envió el correo de recuperación');
    return token;
  };

  describe('solicitud', () => {
    it('cuenta existente: 202 genérico, correo enviado con el enlace, token guardado solo como hash', async () => {
      const user = await createUser(ctx, 'ana@example.com');
      const res = await forgot('ana@example.com').expect(202);
      await ctx.app.get(PasswordService).drainPendingMail();

      expect(res.body).toEqual({
        message: 'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.',
      });
      expect(ctx.mailer.sent).toHaveLength(1);
      const mail = ctx.mailer.sent[0];
      expect(mail.to).toBe('ana@example.com');
      const token = ctx.mailer.lastTokenFor('ana@example.com')!;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(mail.text).toContain(`http://localhost:5173/reset-password#token=${token}`);
      expect(mail.text).toContain('30 minutos');

      // Ni la respuesta pública ni la base de datos contienen el token en claro.
      expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain(token);
      const rows = await ctx.prisma.passwordResetToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: user.id,
        tokenHash: sha256(token),
        consumedAt: null,
        invalidatedAt: null,
      });
      expect(JSON.stringify(rows)).not.toContain(token);
      const dump = await ctx.prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM password_reset_tokens');
      expect(JSON.stringify(dump)).not.toContain(token);
      expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBe(30 * 60 * 1000);
    });

    it('cuenta inexistente: respuesta IDÉNTICA, sin correo ni filas', async () => {
      await createUser(ctx, 'ana@example.com');
      const known = await forgot('ana@example.com');
      const unknown = await forgot('nadie@example.com');
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(unknown.headers['content-type']).toBe(known.headers['content-type']);
      expect(unknown.headers['content-length']).toBe(known.headers['content-length']);

      await ctx.app.get(PasswordService).drainPendingMail();
      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['ana@example.com']);
      expect(await ctx.prisma.passwordResetToken.count()).toBe(1);
    });

    it('normaliza el correo (mayúsculas y espacios)', async () => {
      await createUser(ctx, 'ana@example.com');
      await forgot('  ANA@Example.COM ').expect(202);
      await ctx.app.get(PasswordService).drainPendingMail();
      expect(ctx.mailer.sent).toHaveLength(1);
    });

    it('un correo mal formado es 400 (no depende de la cuenta)', async () => {
      await forgot('no-es-correo').expect(400);
      await ctx.http().post('/api/auth/password/forgot').send({}).expect(400);
    });

    it('un fallo del proveedor de correo no cambia la respuesta pública ni filtra detalles', async () => {
      await createUser(ctx, 'ana@example.com');
      ctx.mailer.failWith = new Error('SMTP caído');
      const res = await forgot('ana@example.com').expect(202);
      expect(JSON.stringify(res.body)).not.toContain('SMTP');
      await ctx.app.get(PasswordService).drainPendingMail();
      expect(ctx.mailer.sent).toHaveLength(0);
    });

    it('un correo "mailer" que lanza de forma síncrona tampoco rompe la solicitud', async () => {
      await createUser(ctx, 'ana@example.com');
      const mailer = ctx.app.get(Mailer);
      const spy = jest.spyOn(mailer, 'send').mockImplementation(() => {
        throw new Error('fallo síncrono');
      });
      try {
        await forgot('ana@example.com').expect(202);
        await ctx.app.get(PasswordService).drainPendingMail();
      } finally {
        spy.mockRestore();
      }
    });

    it('solicitar la recuperación NO revoca las sesiones (cualquiera podría pedirla para otro)', async () => {
      const { token } = await signIn(ctx, 'ana@example.com');
      await requestToken('ana@example.com');
      await ctx.http().get('/api/users/me').set(bearer(token)).expect(200);
    });

    it('un nuevo token invalida el anterior; solo queda uno pendiente', async () => {
      const user = await createUser(ctx, 'ana@example.com');
      const first = await requestToken('ana@example.com');
      ctx.clock.advanceSeconds(61); // pasada la espera mínima
      const second = await requestToken('ana@example.com');
      expect(second).not.toBe(first);

      const pending = await ctx.prisma.passwordResetToken.count({
        where: { userId: user.id, consumedAt: null, invalidatedAt: null },
      });
      expect(pending).toBe(1);
      await reset(first).expect(400);
      await reset(second).expect(200);
    });

    it('espera mínima: una segunda solicitud inmediata no genera ni envía otro token', async () => {
      await createUser(ctx, 'ana@example.com');
      const first = await requestToken('ana@example.com');
      await forgot('ana@example.com').expect(202); // misma respuesta
      await ctx.app.get(PasswordService).drainPendingMail();
      expect(ctx.mailer.sent).toHaveLength(1);
      expect(await ctx.prisma.passwordResetToken.count()).toBe(1);
      await reset(first).expect(200); // el primero sigue siendo válido
    });

    it('el índice único parcial impide dos tokens pendientes para el mismo usuario', async () => {
      const user = await createUser(ctx, 'ana@example.com');
      const base = {
        userId: user.id,
        createdAt: ctx.clock.now(),
        expiresAt: new Date(ctx.clock.now().getTime() + 1000),
      };
      await ctx.prisma.passwordResetToken.create({ data: { ...base, tokenHash: 'a' } });
      await expect(
        ctx.prisma.passwordResetToken.create({ data: { ...base, tokenHash: 'b' } }),
      ).rejects.toThrow();
      // Uno consumido o invalidado no cuenta como pendiente.
      await ctx.prisma.passwordResetToken.create({
        data: { ...base, tokenHash: 'c', consumedAt: base.createdAt },
      });
      await ctx.prisma.passwordResetToken.create({
        data: { ...base, tokenHash: 'd', invalidatedAt: base.createdAt },
      });
    });

    it('limita las solicitudes por IP (429 + Retry-After) con independencia de que las cuentas existan', async () => {
      for (let i = 0; i < 10; i++) await forgot(`nadie${i}@example.com`, '198.51.100.9').expect(202);
      const blocked = await forgot('otra@example.com', '198.51.100.9').expect(429);
      expect(blocked.headers['retry-after']).toBe('900');
      await forgot('otra@example.com', '198.51.100.10').expect(202); // otra IP no se ve afectada

      ctx.clock.advanceSeconds(901);
      await forgot('otra@example.com', '198.51.100.9').expect(202);
    });

    it('funciona para docentes y administradores', async () => {
      for (const role of [UserRole.TEACHER, UserRole.ADMIN]) {
        const email = `${role.toLowerCase()}@example.com`;
        await createUser(ctx, email, { role });
        const token = await requestToken(email);
        await reset(token).expect(200);
        await login(ctx, email, NEW_PASSWORD).expect(200);
      }
    });
  });

  describe('restablecimiento', () => {
    it('cambia la contraseña, consume el token y NO inicia sesión', async () => {
      const user = await createUser(ctx, 'ana@example.com');
      const token = await requestToken('ana@example.com');

      const res = await reset(token).expect(200);
      expect(res.body).toEqual({
        message: 'Contraseña restablecida. Inicia sesión con la nueva contraseña.',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/accessToken|scrypt|passwordHash/);

      await login(ctx, 'ana@example.com', PASSWORD).expect(401);
      await login(ctx, 'ana@example.com', NEW_PASSWORD).expect(200);
      const row = await ctx.prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(row.consumedAt).toEqual(ctx.clock.now());
      expect(row.invalidatedAt).toBeNull();
    });

    it('revoca TODAS las sesiones activas del usuario y solo las suyas', async () => {
      const ana = await signIn(ctx, 'ana@example.com');
      const ana2 = (await login(ctx, 'ana@example.com', PASSWORD).expect(200)).body.accessToken as string;
      const bea = await signIn(ctx, 'bea@example.com');
      const token = await requestToken('ana@example.com');

      await reset(token).expect(200);

      await ctx.http().get('/api/users/me').set(bearer(ana.token)).expect(401);
      await ctx.http().get('/api/users/me').set(bearer(ana2)).expect(401);
      await ctx.http().get('/api/users/me').set(bearer(bea.token)).expect(200);
      const rows = await ctx.prisma.authSession.findMany({ where: { userId: ana.userId } });
      expect(rows.every((s) => s.revocationReason === 'PASSWORD_RESET' && s.revokedAt)).toBe(true);
    });

    it('un token usado no sirve una segunda vez (mismo mensaje que cualquier token inválido)', async () => {
      await createUser(ctx, 'ana@example.com');
      const token = await requestToken('ana@example.com');
      await reset(token).expect(200);

      const reused = await reset(token, 'otra-clave-completamente-distinta').expect(400);
      expect(reused.body.message).toBe(INVALID_MESSAGE);
      await login(ctx, 'ana@example.com', 'otra-clave-completamente-distinta').expect(401);
      await login(ctx, 'ana@example.com', NEW_PASSWORD).expect(200);
    });

    it('rechaza tokens inexistentes, mal formados o vacíos con el mismo mensaje', async () => {
      await createUser(ctx, 'ana@example.com');
      await requestToken('ana@example.com');
      for (const token of ['x'.repeat(43), 'corto', "' OR 1=1 --", '%00']) {
        const res = await reset(token).expect(400);
        expect(res.body.message).toBe(INVALID_MESSAGE);
      }
      await reset('').expect(400);
      await ctx.http().post('/api/auth/password/reset').send({ newPassword: NEW_PASSWORD }).expect(400);
    });

    it('rechaza un token caducado (30 min) y permite uno justo antes del límite', async () => {
      await createUser(ctx, 'ana@example.com');
      const token = await requestToken('ana@example.com');

      ctx.clock.advanceSeconds(30 * 60);
      const expired = await reset(token).expect(400);
      expect(expired.body.message).toBe(INVALID_MESSAGE);
      await login(ctx, 'ana@example.com', PASSWORD).expect(200); // la contraseña no cambió

      ctx.clock.advanceSeconds(-1); // 29:59 desde la emisión
      await reset(token).expect(200);
    });

    it('con una contraseña débil falla SIN consumir el token', async () => {
      await createUser(ctx, 'ana@example.com');
      const token = await requestToken('ana@example.com');
      const res = await reset(token, 'password123').expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(/común/);
      await reset(token, 'corta').expect(400);
      await reset(token, NEW_PASSWORD).expect(200);
    });

    it('limpia el bloqueo de login del correo: quien recupera la cuenta puede entrar de inmediato', async () => {
      await createUser(ctx, 'ana@example.com');
      for (let i = 0; i < 6; i++) await login(ctx, 'ana@example.com', 'mala-clave-xx', { ip: '203.0.113.5' });
      await login(ctx, 'ana@example.com', PASSWORD, { ip: '203.0.113.5' }).expect(429);

      const token = await requestToken('ana@example.com');
      await ctx
        .http()
        .post('/api/auth/password/reset')
        .set('X-Forwarded-For', '203.0.113.5')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200);
      await login(ctx, 'ana@example.com', NEW_PASSWORD, { ip: '203.0.113.5' }).expect(200);
    });

    it('tras el restablecimiento no queda ningún token pendiente', async () => {
      const user = await createUser(ctx, 'ana@example.com');
      const token = await requestToken('ana@example.com');
      await reset(token).expect(200);
      const rows = await ctx.prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      expect(rows.filter((r) => !r.consumedAt && !r.invalidatedAt)).toHaveLength(0);
    });
  });

  describe('concurrencia', () => {
    it('dos envíos simultáneos del mismo token: exactamente uno prospera y la contraseña es la del ganador', async () => {
      await createUser(ctx, 'ana@example.com');
      const token = await requestToken('ana@example.com');
      const passwords = ['clave-del-envio-numero-uno', 'clave-del-envio-numero-dos'];

      const results = await Promise.all(passwords.map((p) => reset(token, p)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 400]);

      const winner = passwords[results.findIndex((r) => r.status === 200)];
      const loser = passwords[results.findIndex((r) => r.status === 400)];
      expect(results.find((r) => r.status === 400)!.body.message).toBe(INVALID_MESSAGE);
      await login(ctx, 'ana@example.com', winner).expect(200);
      await login(ctx, 'ana@example.com', loser).expect(401);
      expect(await ctx.prisma.passwordResetToken.count({ where: { consumedAt: { not: null } } })).toBe(1);
    });

    it('muchos envíos simultáneos: una sola contraseña nueva y una sola revocación', async () => {
      const ana = await signIn(ctx, 'ana@example.com');
      const token = await requestToken('ana@example.com');
      const passwords = Array.from({ length: 5 }, (_, i) => `clave-concurrente-numero-${i}`);
      const results = await Promise.all(passwords.map((p) => reset(token, p)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(4);
      await ctx.http().get('/api/users/me').set(bearer(ana.token)).expect(401);
    });

    it('solicitudes de recuperación simultáneas del mismo usuario dejan un único token pendiente', async () => {
      const user = await createUser(ctx, 'ana@example.com');
      const results = await Promise.all(Array.from({ length: 6 }, () => forgot('ana@example.com')));
      expect(results.every((r) => r.status === 202)).toBe(true);
      await ctx.app.get(PasswordService).drainPendingMail();
      expect(
        await ctx.prisma.passwordResetToken.count({
          where: { userId: user.id, consumedAt: null, invalidatedAt: null },
        }),
      ).toBe(1);
      expect(ctx.mailer.sent).toHaveLength(1);
    });
  });

  describe('sin fugas en registros', () => {
    it('el token de recuperación nunca aparece en la salida estándar con el proveedor por defecto', async () => {
      const writes: string[] = [];
      const spies = (['stdout', 'stderr'] as const).map((stream) =>
        jest.spyOn(process[stream], 'write').mockImplementation(((chunk: unknown) => {
          writes.push(String(chunk));
          return true;
        }) as never),
      );
      let token: string;
      try {
        await createUser(ctx, 'ana@example.com');
        ctx.mailer.failWith = new Error('proveedor caído');
        await forgot('ana@example.com').expect(202);
        await ctx.app.get(PasswordService).drainPendingMail();
        ctx.mailer.clear();
        ctx.clock.advanceSeconds(61);
        token = await requestToken('ana@example.com');
        await reset(token).expect(200);
        await reset(token).expect(400);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
      const output = writes.join('');
      expect(output).not.toContain(token);
      expect(output).not.toContain(NEW_PASSWORD);
      expect(output).not.toContain(sha256(token));
    });
  });
});
