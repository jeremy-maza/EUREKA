import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '../../prisma/migrations');
const TARGET = '20261121180000_groups_and_teachers';

const migrationNames = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const sql = (name: string): string => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');

/**
 * La migración de grupos debe poder aplicarse sobre una base con datos reales sin perderlos ni romperse.
 * (Sobre base limpia ya se ejercita en cada ejecución: el globalSetup aplica TODAS las migraciones.)
 */
describe('migración groups_and_teachers sobre una base con datos existentes', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    const previous = migrationNames.slice(0, migrationNames.indexOf(TARGET));
    expect(previous.length).toBeGreaterThanOrEqual(2);
    for (const name of previous) await db.exec(sql(name));

    // Datos "legados" con el esquema anterior: 2 grupos, 3 usuarios, membresías y asignaciones.
    await db.exec(`
      INSERT INTO users (id, email, "displayName", "passwordHash", role, "updatedAt") VALUES
        ('00000000-0000-7000-8000-000000000001', 'teacher@example.com', 'Docente', 'scrypt$x', 'TEACHER', now()),
        ('00000000-0000-7000-8000-000000000002', 'ana@example.com', 'Ana', 'scrypt$x', 'STUDENT', now()),
        ('00000000-0000-7000-8000-000000000003', 'bea@example.com', 'Bea', 'scrypt$x', 'STUDENT', now());
      INSERT INTO groups (id, name, "updatedAt") VALUES
        ('00000000-0000-7000-8000-0000000000a1', 'Grupo viejo 1', now()),
        ('00000000-0000-7000-8000-0000000000a2', 'Grupo viejo 2', now());
      INSERT INTO group_memberships (id, "userId", "groupId") VALUES
        (gen_random_uuid(), '00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000a1'),
        (gen_random_uuid(), '00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000a2'),
        (gen_random_uuid(), '00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-0000000000a1');
      INSERT INTO teacher_group_assignments (id, "teacherId", "groupId") VALUES
        (gen_random_uuid(), '00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1');
    `);

    await db.exec(sql(TARGET));
  });
  afterAll(() => db.close());

  const rows = async <T>(query: string): Promise<T[]> => (await db.query<T>(query)).rows;

  it('conserva todas las filas y las deja ACTIVAS', async () => {
    expect(await rows('SELECT count(*)::int AS n FROM groups')).toEqual([{ n: 2 }]);
    expect(await rows(`SELECT status, "deactivatedAt", description FROM groups`)).toEqual([
      { status: 'ACTIVE', deactivatedAt: null, description: null },
      { status: 'ACTIVE', deactivatedAt: null, description: null },
    ]);
    expect(await rows(`SELECT status, count(*)::int AS n FROM group_memberships GROUP BY status`)).toEqual([
      { status: 'ACTIVE', n: 3 },
    ]);
    expect(
      await rows(`SELECT status, count(*)::int AS n FROM teacher_group_assignments GROUP BY status`),
    ).toEqual([{ status: 'ACTIVE', n: 1 }]);
    expect(await rows('SELECT count(*)::int AS n FROM users')).toEqual([{ n: 3 }]);
  });

  it('impone los nuevos invariantes sobre los datos migrados', async () => {
    // Duplicado ACTIVE: rechazado por el índice único parcial.
    await expect(
      db.exec(`INSERT INTO group_memberships (id, "userId", "groupId") VALUES
        (gen_random_uuid(), '00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000a1')`),
    ).rejects.toThrow(/one_active/);

    // Historial: tras retirar a Ana del grupo 1, puede reincorporarse (fila nueva) conservando la antigua.
    await db.exec(`UPDATE group_memberships SET status = 'REMOVED', "removedAt" = now()
      WHERE "userId" = '00000000-0000-7000-8000-000000000002' AND "groupId" = '00000000-0000-7000-8000-0000000000a1'`);
    await db.exec(`INSERT INTO group_memberships (id, "userId", "groupId") VALUES
      (gen_random_uuid(), '00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000a1')`);
    expect(
      await rows(`SELECT status, count(*)::int AS n FROM group_memberships
        WHERE "userId" = '00000000-0000-7000-8000-000000000002' AND "groupId" = '00000000-0000-7000-8000-0000000000a1'
        GROUP BY status ORDER BY status`),
    ).toEqual([
      { status: 'ACTIVE', n: 1 },
      { status: 'REMOVED', n: 1 },
    ]);

    // Estado ↔ fecha coherentes y triggers de rol.
    await expect(db.exec(`UPDATE groups SET status = 'INACTIVE'`)).rejects.toThrow(/status_consistency/);
    await expect(
      db.exec(`INSERT INTO teacher_group_assignments (id, "teacherId", "groupId") VALUES
        (gen_random_uuid(), '00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000a2')`),
    ).rejects.toThrow(/rol TEACHER/);
    await expect(
      db.exec(`INSERT INTO group_memberships (id, "userId", "groupId") VALUES
        (gen_random_uuid(), '00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a2')`),
    ).rejects.toThrow(/rol STUDENT/);
  });
});
