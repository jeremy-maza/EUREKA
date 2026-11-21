// TRUST_PROXY se valida al IMPORTAR AppModule (ConfigModule.forRoot), así que debe fijarse antes de los imports.
process.env.TRUST_PROXY = 'false';

import { createUser, login } from '../helpers/auth-helpers';
import { createTestApp, PASSWORD, TestContext } from '../helpers/test-app';

const WRONG = 'clave-incorrecta-xx';

/** Valor por defecto de producción (TRUST_PROXY sin definir): `X-Forwarded-For` se ignora por completo. */
describe('Limitación de login sin proxy de confianza (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('cambiar X-Forwarded-For no sirve para eludir el límite: todos los intentos cuentan para la misma IP real', async () => {
    await createUser(ctx, 'ana@example.com');
    for (let i = 0; i < 5; i++) {
      await login(ctx, 'ana@example.com', WRONG, { ip: `198.51.100.${i}` }).expect(401);
    }
    await login(ctx, 'ana@example.com', PASSWORD, { ip: '198.51.100.200' }).expect(429);
  });

  it('las sesiones guardan la IP del socket, no la cabecera falsificada', async () => {
    await createUser(ctx, 'ana@example.com');
    await login(ctx, 'ana@example.com', PASSWORD, { ip: '198.51.100.77' }).expect(200);
    const session = await ctx.prisma.authSession.findFirstOrThrow();
    expect(session.ipAddress).not.toContain('198.51.100.77');
    expect(session.ipAddress).toMatch(/127\.0\.0\.1|::1/);
  });
});
