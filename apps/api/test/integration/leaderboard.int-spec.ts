import { UserRole } from '../../src/generated/prisma/client';
import { enrollStudent, makeGroup } from '../helpers/factories';
import { createTestApp, Player, TestContext } from '../helpers/test-app';

describe('Clasificación del mundo (HTTP + PostgreSQL real)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  /** Da por completado el reto 1 con `7*1*3` (100 puntos con racha 0). */
  async function score(player: Player, correctAnswers: number): Promise<void> {
    const session = (await player.startSession()).body.session.id as string;
    const solutions = ['7*1*3', '7*1*6'];
    for (const expression of solutions.slice(0, correctAnswers)) {
      const { answered } = await player.play(session, expression);
      expect(answered.outcome).toBe('CORRECT');
    }
  }

  it('sin grupos solo aparece el propio jugador (scope SELF)', async () => {
    const ana = await Player.register(ctx, 'ana@example.com', UserRole.STUDENT, 'Ana');
    await Player.register(ctx, 'beto@example.com', UserRole.STUDENT, 'Beto');

    const res = await ana.get('/worlds/arithmetic/leaderboard').expect(200);
    expect(res.body).toMatchObject({
      worldSlug: 'arithmetic',
      scope: 'SELF',
      participants: 1,
      entries: [{ rank: 1, displayName: 'Ana', points: 0, isCurrentUser: true }],
      me: { rank: 1, displayName: 'Ana', isCurrentUser: true },
    });
  });

  it('ordena a los compañeros de grupo por puntos y no expone ids ni correos; excluye a otros grupos', async () => {
    const ana = await Player.register(ctx, 'ana@example.com', UserRole.STUDENT, 'Ana');
    const beto = await Player.register(ctx, 'beto@example.com', UserRole.STUDENT, 'Beto');
    const carla = await Player.register(ctx, 'carla@example.com', UserRole.STUDENT, 'Carla');
    const ajeno = await Player.register(ctx, 'ajeno@example.com', UserRole.STUDENT, 'Ajeno');
    const g1 = await makeGroup(ctx.prisma, 'G1');
    const g2 = await makeGroup(ctx.prisma, 'G2');
    for (const p of [ana, beto, carla]) await enrollStudent(ctx.prisma, g1.id, p.userId);
    await enrollStudent(ctx.prisma, g2.id, ajeno.userId);
    await score(beto, 2); // 100 + 150
    await score(ana, 1); // 100
    await score(ajeno, 2); // no debe aparecer

    const res = await ana.get('/worlds/arithmetic/leaderboard').expect(200);
    expect(res.body.scope).toBe('GROUPS');
    expect(res.body.participants).toBe(3);
    expect(
      res.body.entries.map((e: { displayName: string; points: number; rank: number }) => [
        e.rank,
        e.displayName,
        e.points,
      ]),
    ).toEqual([
      [1, 'Beto', 250],
      [2, 'Ana', 100],
      [3, 'Carla', 0],
    ]);
    expect(res.body.me).toMatchObject({ rank: 2, points: 100, isCurrentUser: true });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('example.com');
    expect(serialized).not.toContain(beto.userId);
    expect(serialized).not.toContain('Ajeno');
  });

  it('los empates comparten posición, `limit` recorta la lista pero `me` siempre viene', async () => {
    const ana = await Player.register(ctx, 'ana@example.com', UserRole.STUDENT, 'Ana');
    const beto = await Player.register(ctx, 'beto@example.com', UserRole.STUDENT, 'Beto');
    const carla = await Player.register(ctx, 'carla@example.com', UserRole.STUDENT, 'Carla');
    const g = await makeGroup(ctx.prisma);
    for (const p of [ana, beto, carla]) await enrollStudent(ctx.prisma, g.id, p.userId);
    await score(ana, 1);
    await score(beto, 1);

    const res = await carla.get('/worlds/arithmetic/leaderboard?limit=1').expect(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ rank: 1, displayName: 'Ana' });
    expect(res.body.participants).toBe(3);
    expect(res.body.me).toMatchObject({ rank: 3, displayName: 'Carla', points: 0 });
    const full = await carla.get('/worlds/arithmetic/leaderboard').expect(200);
    expect(full.body.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 1, 3]);
  });

  it('ignora membresías retiradas y grupos desactivados', async () => {
    const ana = await Player.register(ctx, 'ana@example.com', UserRole.STUDENT, 'Ana');
    const beto = await Player.register(ctx, 'beto@example.com', UserRole.STUDENT, 'Beto');
    const g = await makeGroup(ctx.prisma);
    await enrollStudent(ctx.prisma, g.id, ana.userId);
    const membership = await enrollStudent(ctx.prisma, g.id, beto.userId);
    await ctx.prisma.groupMembership.update({
      where: { id: membership.id },
      data: { status: 'REMOVED', removedAt: new Date() },
    });
    expect((await ana.get('/worlds/arithmetic/leaderboard').expect(200)).body.participants).toBe(1);

    await ctx.prisma.group.update({
      where: { id: g.id },
      data: { status: 'INACTIVE', deactivatedAt: new Date() },
    });
    expect((await ana.get('/worlds/arithmetic/leaderboard').expect(200)).body.scope).toBe('SELF');
  });

  it('exige sesión, solo estudiantes y un mundo existente', async () => {
    const ana = await Player.register(ctx, 'ana@example.com', UserRole.STUDENT, 'Ana');
    const profe = await Player.register(ctx, 'profe@example.com', UserRole.TEACHER);
    await ctx.http().get('/api/worlds/arithmetic/leaderboard').expect(401);
    await profe.get('/worlds/arithmetic/leaderboard').expect(403);
    await ana.get('/worlds/no-existe/leaderboard').expect(404);
    await ana.get('/worlds/arithmetic/leaderboard?limit=0').expect(400);
  });
});
