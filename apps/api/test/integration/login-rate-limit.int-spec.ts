import { bearer, createUser, jtiOf, login } from '../helpers/auth-helpers';
import { createTestApp, PASSWORD, TestContext } from '../helpers/test-app';

const WRONG = 'clave-incorrecta-xx';
const GENERIC = 'Demasiados intentos. Inténtalo de nuevo más tarde.';

describe('Limitación de intentos de login (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;

  // Configuración por defecto (la recomendada para producción): 5 por IP+correo, 20 por correo, 100 por IP.
  // El ámbito por IP se prueba aparte (login-rate-limit-ip.int-spec.ts) con un umbral reducido.
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const IP_A = '203.0.113.10';
  const IP_B = '203.0.113.20';

  /** n intentos fallidos seguidos; devuelve los códigos de estado. */
  async function fail(email: string, n: number, ip = IP_A): Promise<number[]> {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) statuses.push((await login(ctx, email, WRONG, { ip })).status);
    return statuses;
  }

  describe('por IP + correo', () => {
    it('permite 5 intentos fallidos (401) y bloquea el sexto (429), incluso con la contraseña correcta', async () => {
      await createUser(ctx, 'ana@example.com');
      expect(await fail('ana@example.com', 5)).toEqual([401, 401, 401, 401, 401]);

      const blocked = await login(ctx, 'ana@example.com', WRONG, { ip: IP_A }).expect(429);
      expect(blocked.body).toMatchObject({ statusCode: 429, error: 'TOO_MANY_REQUESTS', message: GENERIC });
      expect(blocked.headers['retry-after']).toBe('60');

      // Con la contraseña buena durante el bloqueo: sigue bloqueado y no se revela que era correcta.
      const correct = await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A }).expect(429);
      expect(correct.body.message).toBe(GENERIC);
      expect(await ctx.prisma.authSession.count()).toBe(0);
    });

    it('no expone el estado interno: ni contadores, ni intentos restantes, ni qué límite saltó', async () => {
      await createUser(ctx, 'ana@example.com');
      const failed = await login(ctx, 'ana@example.com', WRONG, { ip: IP_A }).expect(401);
      expect(Object.keys(failed.headers)).not.toEqual(
        expect.arrayContaining(['retry-after', 'x-ratelimit-remaining']),
      );
      expect(Object.keys(failed.headers).some((h) => h.startsWith('x-ratelimit'))).toBe(false);

      await fail('ana@example.com', 4);
      const blocked = await login(ctx, 'ana@example.com', WRONG, { ip: IP_A }).expect(429);
      const text = JSON.stringify(blocked.body);
      expect(text).not.toMatch(/attempt|intento[s]? restante|remaining|lock|scope|ip|email/i);
      expect(Object.keys(blocked.headers).some((h) => h.startsWith('x-ratelimit'))).toBe(false);
    });

    it('el bloqueo expira solo y el login correcto vuelve a funcionar (sin bloqueo permanente)', async () => {
      await createUser(ctx, 'ana@example.com');
      await fail('ana@example.com', 6);
      ctx.clock.advanceSeconds(59);
      await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A }).expect(429);
      ctx.clock.advanceSeconds(1);
      const ok = await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A }).expect(200);
      await ctx.http().get('/api/users/me').set(bearer(ok.body.accessToken)).expect(200);
    });

    it('el bloqueo es progresivo: 60 s → 120 s → 240 s (el tope de 900 s se prueba en throttle-state.spec)', async () => {
      await createUser(ctx, 'ana@example.com');
      const waits: string[] = [];
      for (let round = 0; round < 3; round++) {
        await fail('ana@example.com', 5);
        const blocked = await login(ctx, 'ana@example.com', WRONG, { ip: IP_A }).expect(429);
        waits.push(blocked.headers['retry-after']);
        ctx.clock.advanceSeconds(Number(blocked.headers['retry-after']));
      }
      expect(waits).toEqual(['60', '120', '240']);
    });

    it('tras un largo periodo de calma el nivel de bloqueo vuelve al inicial', async () => {
      await createUser(ctx, 'ana@example.com');
      await fail('ana@example.com', 5);
      await login(ctx, 'ana@example.com', WRONG, { ip: IP_A }).expect(429); // nivel 1
      ctx.clock.advanceSeconds(60 + 900 + 1); // fin del bloqueo + una ventana completa sin actividad
      await fail('ana@example.com', 5);
      const blocked = await login(ctx, 'ana@example.com', WRONG, { ip: IP_A }).expect(429);
      expect(blocked.headers['retry-after']).toBe('60');
    });

    it('las ventanas antiguas no acumulan: intentos espaciados más de 15 min nunca bloquean', async () => {
      await createUser(ctx, 'ana@example.com');
      for (let i = 0; i < 4; i++) {
        expect(await fail('ana@example.com', 4)).toEqual([401, 401, 401, 401]);
        ctx.clock.advanceSeconds(901);
      }
    });

    it('un login correcto reinicia el contador del par: 4 fallos + éxito + 4 fallos no bloquean', async () => {
      await createUser(ctx, 'ana@example.com');
      await fail('ana@example.com', 4);
      await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A }).expect(200);
      expect(await fail('ana@example.com', 4)).toEqual([401, 401, 401, 401]);
      expect(await ctx.prisma.authThrottle.count({ where: { scope: 'LOGIN_IP_EMAIL' } })).toBe(1);
    });

    it('los logins correctos repetidos nunca se limitan (el intento se devuelve)', async () => {
      await createUser(ctx, 'ana@example.com');
      for (let i = 0; i < 12; i++) await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A }).expect(200);
      const rows = await ctx.prisma.authThrottle.findMany();
      expect(rows.filter((r) => r.scope !== 'LOGIN_IP_EMAIL').every((r) => r.attempts === 0)).toBe(true);
    });

    it('normaliza el correo: mayúsculas y espacios comparten contador', async () => {
      await createUser(ctx, 'ana@example.com');
      const variants = [
        'ana@example.com',
        'ANA@example.com',
        ' Ana@Example.COM ',
        'ana@EXAMPLE.com',
        'aNa@example.com',
      ];
      for (const email of variants) await login(ctx, email, WRONG, { ip: IP_A }).expect(401);
      await login(ctx, '  ANA@example.com', PASSWORD, { ip: IP_A }).expect(429);
      expect(await ctx.prisma.authThrottle.count({ where: { scope: 'LOGIN_EMAIL' } })).toBe(1);
    });
  });

  describe('sin enumeración de cuentas', () => {
    it('cuenta existente e inexistente producen la misma secuencia de estados, cuerpos y cabeceras', async () => {
      await createUser(ctx, 'existe@example.com');
      const run = async (email: string, ip: string) => {
        const out: { status: number; body: Record<string, unknown>; retry?: string }[] = [];
        for (let i = 0; i < 7; i++) {
          const res = await login(ctx, email, WRONG, { ip });
          const { path: _p, timestamp: _t, ...body } = res.body;
          out.push({ status: res.status, body, retry: res.headers['retry-after'] });
        }
        return out;
      };
      const real = await run('existe@example.com', IP_A);
      const fake = await run('fantasma@example.com', IP_B);
      expect(fake).toEqual(real);
      expect(real.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 429, 429]);
    });

    it('los mensajes 401 son idénticos y el bloqueo se aplica también a correos inexistentes', async () => {
      await createUser(ctx, 'existe@example.com');
      const a = await login(ctx, 'existe@example.com', WRONG, { ip: IP_A }).expect(401);
      const b = await login(ctx, 'fantasma@example.com', WRONG, { ip: IP_A }).expect(401);
      expect(a.body.message).toBe(b.body.message);
      await fail('fantasma@example.com', 5, IP_B);
      await login(ctx, 'fantasma@example.com', PASSWORD, { ip: IP_B }).expect(429);
    });

    it('no guarda correos en claro en la tabla de contadores (solo su SHA-256)', async () => {
      await fail('fantasma@example.com', 2);
      const rows = await ctx.prisma.authThrottle.findMany();
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toMatch(/fantasma|@/);
    });
  });

  describe('por correo (ataque distribuido) y por IP (rociado de contraseñas)', () => {
    it('el bloqueo por IP+correo no deja fuera al dueño legítimo que entra desde otra IP', async () => {
      await createUser(ctx, 'ana@example.com');
      await fail('ana@example.com', 6, IP_A); // el atacante agota su par IP+correo
      await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A }).expect(429);
      await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_B }).expect(200); // la víctima, desde otra IP
    });

    it('20 fallos repartidos entre varias IPs bloquean el correo para todas (sexto cliente incluido)', async () => {
      await createUser(ctx, 'ana@example.com');
      for (let ip = 1; ip <= 5; ip++)
        expect(await fail('ana@example.com', 4, `198.51.100.${ip}`)).toEqual([401, 401, 401, 401]);

      const blocked = await login(ctx, 'ana@example.com', PASSWORD, { ip: '198.51.100.99' }).expect(429);
      expect(blocked.body.message).toBe(GENERIC);
      expect(blocked.headers['retry-after']).toBe('60');
      ctx.clock.advanceSeconds(60);
      await login(ctx, 'ana@example.com', PASSWORD, { ip: '198.51.100.99' }).expect(200);
    });

    it('un éxito no devuelve al atacante distribuido su presupuesto por correo', async () => {
      await createUser(ctx, 'ana@example.com');
      for (let ip = 1; ip <= 4; ip++) await fail('ana@example.com', 4, `198.51.100.${ip}`); // 16 fallos
      await login(ctx, 'ana@example.com', PASSWORD, { ip: '198.51.100.50' }).expect(200); // el dueño entra
      const row = await ctx.prisma.authThrottle.findFirstOrThrow({ where: { scope: 'LOGIN_EMAIL' } });
      expect(row.attempts).toBe(16); // solo se devuelve el intento propio; no se pone a cero
    });

    it('IPv6: direcciones del mismo /64 comparten contador; las de otro /64 no', async () => {
      await createUser(ctx, 'ana@example.com');
      for (let i = 1; i <= 3; i++)
        await login(ctx, 'ana@example.com', WRONG, { ip: `2001:db8:abcd:12::${i}` }).expect(401);
      for (let i = 4; i <= 5; i++)
        await login(ctx, 'ana@example.com', WRONG, { ip: `2001:db8:abcd:12::${i}` }).expect(401);
      await login(ctx, 'ana@example.com', WRONG, { ip: '2001:db8:abcd:12:ffff::9' }).expect(429);
      await login(ctx, 'ana@example.com', PASSWORD, { ip: '2001:db8:abcd:13::1' }).expect(200);
    });

    it('con un salto de proxy de confianza solo cuenta la última IP de X-Forwarded-For (el cliente no puede inventarla)', async () => {
      await createUser(ctx, 'ana@example.com');
      for (let i = 0; i < 5; i++) {
        await ctx
          .http()
          .post('/api/auth/login')
          .set('X-Forwarded-For', `10.0.0.${i}, ${IP_A}`) // el cliente inventa el primer valor; el proxy añade el real
          .send({ email: 'ana@example.com', password: WRONG })
          .expect(401);
      }
      await ctx
        .http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', `10.9.9.9, ${IP_A}`)
        .send({ email: 'ana@example.com', password: PASSWORD })
        .expect(429);
    });
  });

  describe('concurrencia', () => {
    it('12 intentos fallidos simultáneos: exactamente 5 llegan a verificar la contraseña y el resto recibe 429', async () => {
      await createUser(ctx, 'ana@example.com');
      const results = await Promise.all(
        Array.from({ length: 12 }, () => login(ctx, 'ana@example.com', WRONG, { ip: IP_A })),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 401)).toHaveLength(5);
      expect(statuses.filter((s) => s === 429)).toHaveLength(7);

      const pair = await ctx.prisma.authThrottle.findFirstOrThrow({ where: { scope: 'LOGIN_IP_EMAIL' } });
      expect(pair.lockLevel).toBe(1); // un solo bloqueo, no uno por petición
      expect(pair.lockedUntil).not.toBeNull();
    });

    it('rondas concurrentes con la contraseña correcta mezclada no superan el límite ni crean sesiones tras el bloqueo', async () => {
      await createUser(ctx, 'ana@example.com');
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          login(ctx, 'ana@example.com', i === 7 ? PASSWORD : WRONG, { ip: IP_A }),
        ),
      );
      const verified = results.filter((r) => r.status !== 429);
      expect(verified.length).toBeLessThanOrEqual(5);
      expect(await ctx.prisma.authSession.count()).toBe(results.filter((r) => r.status === 200).length);
    });

    it('logins correctos concurrentes del mismo usuario funcionan todos y devuelven sus intentos', async () => {
      await createUser(ctx, 'ana@example.com');
      // Los intentos se cuentan en vuelo: hasta 5 simultáneos por IP+correo caben siempre (ver limitaciones en docs).
      const results = await Promise.all(
        Array.from({ length: 5 }, () => login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A })),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => jtiOf(r.body.accessToken))).size).toBe(5);
      const rows = await ctx.prisma.authThrottle.findMany({ where: { scope: { not: 'LOGIN_IP_EMAIL' } } });
      expect(rows.every((r) => r.attempts === 0)).toBe(true);
    });
  });

  describe('un atacante bloqueado no agota los contadores de la víctima', () => {
    it('mientras el par está bloqueado, las peticiones rechazadas no cuentan en los demás ámbitos', async () => {
      await createUser(ctx, 'ana@example.com');
      await fail('ana@example.com', 5, IP_A);
      await login(ctx, 'ana@example.com', WRONG, { ip: IP_A }).expect(429); // el intento que dispara el bloqueo sí cuenta
      const snapshot = async () =>
        (await ctx.prisma.authThrottle.findMany({ orderBy: [{ scope: 'asc' }, { key: 'asc' }] })).map(
          (r) => ({
            scope: r.scope,
            attempts: r.attempts,
            lockLevel: r.lockLevel,
            lockedUntil: r.lockedUntil,
          }),
        );
      const before = await snapshot();
      expect(before.find((r) => r.scope === 'LOGIN_EMAIL')!.attempts).toBe(6);

      for (let i = 0; i < 10; i++) await login(ctx, 'ana@example.com', WRONG, { ip: IP_A }).expect(429);
      expect(await snapshot()).toEqual(before); // las rechazadas no cuentan ni prolongan el bloqueo
    });
  });
});
