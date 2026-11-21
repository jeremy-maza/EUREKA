import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '../../prisma/migrations');
const TARGET = '20261121200000_auth_sessions_and_recovery';

const migrationNames = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const sql = (name: string): string => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');

const U1 = '00000000-0000-7000-8000-000000000001';
const U2 = '00000000-0000-7000-8000-000000000002';

/**
 * La migración de autenticación es ADITIVA. Se comprueba sobre una base con datos reales (usuarios, grupos,
 * membresías, asignaciones y sesiones de juego) y sobre una base limpia, y se verifican sus invariantes.
 */
describe('migración auth_sessions_and_recovery', () => {
  const rows = async <T>(db: PGlite, query: string): Promise<T[]> => (await db.query<T>(query)).rows;

  describe('sobre una base con datos existentes', () => {
    let db: PGlite;
    let before: Record<string, number>;
    const TABLES = [
      'users',
      'groups',
      'group_memberships',
      'teacher_group_assignments',
      'worlds',
      'game_sessions',
    ];

    const counts = async (): Promise<Record<string, number>> =>
      Object.fromEntries(
        await Promise.all(
          TABLES.map(async (t) => [
            t,
            (await rows<{ n: number }>(db, `SELECT count(*)::int AS n FROM ${t}`))[0].n,
          ]),
        ),
      );

    beforeAll(async () => {
      db = new PGlite();
      const previous = migrationNames.slice(0, migrationNames.indexOf(TARGET));
      expect(previous.length).toBeGreaterThanOrEqual(3);
      for (const name of previous) await db.exec(sql(name));

      await db.exec(`
        INSERT INTO users (id, email, "displayName", "passwordHash", role, "updatedAt") VALUES
          ('${U1}', 'teacher@example.com', 'Docente', 'scrypt$32768$8$1$c2FsdA==$aGFzaA==', 'TEACHER', now()),
          ('${U2}', 'ana@example.com', 'Ana', 'scrypt$32768$8$1$c2FsdA==$aGFzaA==', 'STUDENT', now());
        INSERT INTO groups (id, name, "updatedAt") VALUES ('00000000-0000-7000-8000-0000000000a1', 'Grupo', now());
        INSERT INTO group_memberships (id, "userId", "groupId") VALUES
          (gen_random_uuid(), '${U2}', '00000000-0000-7000-8000-0000000000a1');
        INSERT INTO teacher_group_assignments (id, "teacherId", "groupId") VALUES
          (gen_random_uuid(), '${U1}', '00000000-0000-7000-8000-0000000000a1');
      `);
      before = await counts();
      await db.exec(sql(TARGET));
    });
    afterAll(() => db.close());

    it('conserva todas las filas existentes y las contraseñas', async () => {
      expect(await counts()).toEqual(before);
      expect(before.users).toBe(2);
      expect(await rows(db, `SELECT "passwordHash" FROM users ORDER BY email`)).toEqual([
        { passwordHash: 'scrypt$32768$8$1$c2FsdA==$aGFzaA==' },
        { passwordHash: 'scrypt$32768$8$1$c2FsdA==$aGFzaA==' },
      ]);
    });

    it('crea las tablas nuevas vacías y utilizables', async () => {
      for (const table of ['auth_sessions', 'password_reset_tokens', 'auth_throttles']) {
        expect(await rows(db, `SELECT count(*)::int AS n FROM ${table}`)).toEqual([{ n: 0 }]);
      }
      await db.exec(
        `INSERT INTO auth_sessions (id, "userId", "expiresAt") VALUES (gen_random_uuid(), '${U2}', now() + interval '1 hour')`,
      );
      expect(await rows(db, 'SELECT count(*)::int AS n FROM auth_sessions')).toEqual([{ n: 1 }]);
    });

    it('las sesiones y tokens se eliminan en cascada con el usuario; los usuarios existentes no se ven afectados', async () => {
      await db.exec(`
        INSERT INTO password_reset_tokens (id, "userId", "tokenHash", "expiresAt")
          VALUES (gen_random_uuid(), '${U2}', 'h1', now() + interval '1 hour');
        DELETE FROM users WHERE id = '${U2}';
      `);
      expect(await rows(db, 'SELECT count(*)::int AS n FROM auth_sessions')).toEqual([{ n: 0 }]);
      expect(await rows(db, 'SELECT count(*)::int AS n FROM password_reset_tokens')).toEqual([{ n: 0 }]);
      expect(await rows(db, 'SELECT count(*)::int AS n FROM users')).toEqual([{ n: 1 }]);
    });
  });

  describe('sobre una base limpia: invariantes', () => {
    let db: PGlite;
    beforeAll(async () => {
      db = new PGlite();
      for (const name of migrationNames) await db.exec(sql(name));
      await db.exec(`INSERT INTO users (id, email, "displayName", "passwordHash", "updatedAt")
                     VALUES ('${U1}', 'ana@example.com', 'Ana', 'x', now())`);
    });
    afterAll(() => db.close());

    it('una sesión revocada debe tener motivo y una vigente no puede tenerlo', async () => {
      const insert = (revokedAt: string, reason: string) =>
        db.exec(`INSERT INTO auth_sessions (id, "userId", "expiresAt", "revokedAt", "revocationReason")
                 VALUES (gen_random_uuid(), '${U1}', now() + interval '1 hour', ${revokedAt}, ${reason})`);
      await expect(insert('now()', 'NULL')).rejects.toThrow(/revocation_consistent/);
      await expect(insert('NULL', `'LOGOUT'`)).rejects.toThrow(/revocation_consistent/);
      await insert('now()', `'LOGOUT'`);
      await insert('NULL', 'NULL');
    });

    it('una sesión no puede caducar antes de crearse', async () => {
      await expect(
        db.exec(`INSERT INTO auth_sessions (id, "userId", "createdAt", "expiresAt")
                 VALUES (gen_random_uuid(), '${U1}', now(), now() - interval '1 hour')`),
      ).rejects.toThrow(/expires_after_creation/);
    });

    it('un token no puede estar consumido e invalidado a la vez; el hash es único', async () => {
      await expect(
        db.exec(`INSERT INTO password_reset_tokens (id, "userId", "tokenHash", "expiresAt", "consumedAt", "invalidatedAt")
                 VALUES (gen_random_uuid(), '${U1}', 'both', now() + interval '1 hour', now(), now())`),
      ).rejects.toThrow(/single_outcome/);
      await db.exec(`INSERT INTO password_reset_tokens (id, "userId", "tokenHash", "expiresAt", "consumedAt")
                     VALUES (gen_random_uuid(), '${U1}', 'dup', now() + interval '1 hour', now())`);
      await expect(
        db.exec(`INSERT INTO password_reset_tokens (id, "userId", "tokenHash", "expiresAt", "consumedAt")
                 VALUES (gen_random_uuid(), '${U1}', 'dup', now() + interval '1 hour', now())`),
      ).rejects.toThrow(/tokenHash_key|duplicate/);
    });

    it('a lo sumo un token pendiente por usuario (índice único parcial)', async () => {
      const insert = (hash: string, extra = '') =>
        db.exec(`INSERT INTO password_reset_tokens (id, "userId", "tokenHash", "expiresAt" ${extra ? ', ' + extra.split('=')[0] : ''})
                 VALUES (gen_random_uuid(), '${U1}', '${hash}', now() + interval '1 hour' ${extra ? ', now()' : ''})`);
      await insert('pending-1');
      await expect(insert('pending-2')).rejects.toThrow(/one_pending_per_user/);
      await insert('invalidated-ok', '"invalidatedAt"=now()');
    });

    it('los contadores rechazan valores negativos y se identifican por (ámbito, clave)', async () => {
      await expect(
        db.exec(`INSERT INTO auth_throttles (scope, key, attempts, "windowStartedAt", "lastAttemptAt")
                 VALUES ('LOGIN_IP', 'k', -1, now(), now())`),
      ).rejects.toThrow(/non_negative/);
      const insert = `INSERT INTO auth_throttles (scope, key, "windowStartedAt", "lastAttemptAt") VALUES ('LOGIN_IP', 'k', now(), now())`;
      await db.exec(insert);
      await expect(db.exec(insert)).rejects.toThrow(/duplicate|pkey/);
    });
  });
});
