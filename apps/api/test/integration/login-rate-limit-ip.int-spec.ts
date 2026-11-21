import { createUser, login } from '../helpers/auth-helpers';
import { createTestApp, PASSWORD, TestContext } from '../helpers/test-app';

const WRONG = 'clave-incorrecta-xx';

/** Ámbito por IP (rociado de contraseñas) con el umbral reducido a 8 para no necesitar cientos de peticiones. */
describe('Limitación de login por IP (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    process.env.LOGIN_MAX_ATTEMPTS_IP = '8';
    ctx = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.LOGIN_MAX_ATTEMPTS_IP;
    await ctx.close();
  });
  beforeEach(() => ctx.reset());

  const IP_A = '203.0.113.10';
  const IP_B = '203.0.113.20';

  it('rociado de contraseñas: muchos correos distintos desde una misma IP la bloquean', async () => {
    for (let i = 0; i < 8; i++) await login(ctx, `victima${i}@example.com`, WRONG, { ip: IP_A }).expect(401);
    const blocked = await login(ctx, 'otra@example.com', WRONG, { ip: IP_A }).expect(429);
    expect(blocked.body.message).toBe('Demasiados intentos. Inténtalo de nuevo más tarde.');
    expect(blocked.headers['retry-after']).toBe('60');
    await login(ctx, 'otra@example.com', WRONG, { ip: IP_B }).expect(401); // otra IP, intacta
  });

  it('una IP bloqueada tampoco puede entrar a una cuenta válida, y al expirar el bloqueo sí', async () => {
    await createUser(ctx, 'ana@example.com');
    for (let i = 0; i < 8; i++) await login(ctx, `victima${i}@example.com`, WRONG, { ip: IP_A });
    await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A }).expect(429);
    ctx.clock.advanceSeconds(60);
    await login(ctx, 'ana@example.com', PASSWORD, { ip: IP_A }).expect(200);
  });

  it('el acierto devuelve el intento: una IP compartida (aula) con logins correctos no se bloquea', async () => {
    for (let i = 0; i < 20; i++) {
      await createUser(ctx, `alumno${i}@example.com`);
      await login(ctx, `alumno${i}@example.com`, PASSWORD, { ip: IP_A }).expect(200);
    }
  });
});
