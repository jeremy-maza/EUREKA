import { UserRole } from '../../src/generated/prisma/client';
import { createTestApp, PASSWORD, Player, TestContext } from '../helpers/test-app';

describe('Autenticación y autorización (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  const register = (body: object) => ctx.http().post('/api/auth/register').send(body);

  it('registra estudiantes sin exponer el hash y con el correo normalizado', async () => {
    const res = await register({
      email: '  Ana@Example.COM ',
      displayName: ' Ana ',
      password: PASSWORD,
    }).expect(201);
    expect(res.body).toMatchObject({ email: 'ana@example.com', displayName: 'Ana', role: 'STUDENT' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);

    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'ana@example.com' } });
    expect(row.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  it('no permite elegir el rol al registrarse', async () => {
    const res = await register({
      email: 'x@example.com',
      displayName: 'X',
      password: PASSWORD,
      role: 'ADMIN',
    }).expect(400);
    expect(res.body.message).toEqual(expect.arrayContaining(['property role should not exist']));
  });

  it('rechaza correo duplicado (409), correo y contraseña inválidos (400)', async () => {
    await register({ email: 'dup@example.com', displayName: 'D', password: PASSWORD }).expect(201);
    await register({ email: 'DUP@example.com', displayName: 'D', password: PASSWORD }).expect(409);
    await register({ email: 'no-es-correo', displayName: 'D', password: PASSWORD }).expect(400);
    await register({ email: 'a@example.com', displayName: 'D', password: 'corta' }).expect(400);
  });

  it('login: devuelve un token Bearer; credenciales erróneas dan 401 con el mismo mensaje', async () => {
    await register({ email: 'ana@example.com', displayName: 'Ana', password: PASSWORD }).expect(201);

    const ok = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: 'ANA@example.com', password: PASSWORD })
      .expect(200);
    expect(ok.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600 });
    expect(ok.body.accessToken.split('.')).toHaveLength(3);

    const wrongPassword = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', password: 'otra-clave-mala' })
      .expect(401);
    const unknownUser = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: 'nadie@example.com', password: PASSWORD })
      .expect(401);
    expect(wrongPassword.body.message).toBe(unknownUser.body.message);
  });

  it('los endpoints exigen token válido: sin token, manipulado o expirado → 401', async () => {
    await ctx.http().get('/api/users/me').expect(401);
    await ctx.http().get('/api/worlds').expect(401);
    await ctx.http().get('/api/users/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
    await ctx.http().get('/api/users/me').set('Authorization', 'Basic xyz').expect(401);

    const player = await Player.register(ctx, 'ana@example.com');
    await player.get('/users/me').expect(200);
    const [h, b, s] = player.token.split('.');
    await ctx
      .http()
      .get('/api/users/me')
      .set('Authorization', `Bearer ${h}.${b}.${s.slice(0, -2)}xx`)
      .expect(401);

    ctx.clock.advanceSeconds(3601);
    await player.get('/users/me').expect(401);
  });

  it('health y documentación siguen siendo públicos', async () => {
    await ctx.http().get('/api/health').expect(200);
    await ctx.http().get('/api/docs-json').expect(200);
  });

  it('GET /users/me devuelve el perfil propio', async () => {
    const player = await Player.register(ctx, 'ana@example.com');
    const res = await player.get('/users/me').expect(200);
    expect(res.body).toMatchObject({ id: player.userId, email: 'ana@example.com', role: 'STUDENT' });
  });

  it('un token de un usuario eliminado deja de ser válido inmediatamente', async () => {
    const player = await Player.register(ctx, 'ana@example.com');
    await ctx.prisma.user.delete({ where: { id: player.userId } });
    await player.get('/users/me').expect(401);
  });

  it('los endpoints de juego son solo para estudiantes (docentes y admins reciben 403)', async () => {
    for (const role of [UserRole.TEACHER, UserRole.ADMIN]) {
      const staff = await Player.register(ctx, `${role.toLowerCase()}@example.com`, role);
      await staff.get('/users/me').expect(200);
      await staff.get('/worlds').expect(200);
      await staff.get('/progress').expect(403);
      await staff.post('/worlds/arithmetic/sessions').expect(403);
    }
  });
});
