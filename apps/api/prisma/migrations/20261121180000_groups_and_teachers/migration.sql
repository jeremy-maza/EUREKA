-- Gestión de grupos: estado de grupo, historial de membresías y asignaciones docentes, auditoría de actores
-- e invariantes de integridad. Es ADITIVA: conserva todas las filas existentes (las membresías y asignaciones
-- previas pasan a ACTIVE; los grupos previos, a ACTIVE) y no borra ni reescribe datos.

-- ───────────── Enums ─────────────
CREATE TYPE "GroupStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REMOVED');
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- ───────────── Índices únicos totales que impedían conservar el historial ─────────────
-- (userId, groupId) y (teacherId, groupId) pasan a ser únicos solo entre filas ACTIVE (índices parciales abajo).
DROP INDEX "group_memberships_groupId_idx";
DROP INDEX "group_memberships_userId_groupId_key";
DROP INDEX "teacher_group_assignments_groupId_idx";
DROP INDEX "teacher_group_assignments_teacherId_groupId_key";

-- ───────────── Columnas nuevas (todas con valor por defecto o NULL: seguro con datos existentes) ─────────────
ALTER TABLE "groups"
    ADD COLUMN "createdById" UUID,
    ADD COLUMN "deactivatedAt" TIMESTAMP(3),
    ADD COLUMN "description" TEXT,
    ADD COLUMN "status" "GroupStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "group_memberships"
    ADD COLUMN "addedById" UUID,
    ADD COLUMN "removedAt" TIMESTAMP(3),
    ADD COLUMN "removedById" UUID,
    ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "teacher_group_assignments"
    ADD COLUMN "assignedById" UUID,
    ADD COLUMN "revokedAt" TIMESTAMP(3),
    ADD COLUMN "revokedById" UUID,
    ADD COLUMN "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE';

-- ───────────── Índices para consultas con alcance de grupo / docente / estudiante ─────────────
CREATE INDEX "groups_status_idx" ON "groups"("status");
CREATE INDEX "group_memberships_groupId_status_idx" ON "group_memberships"("groupId", "status");
CREATE INDEX "group_memberships_userId_status_idx" ON "group_memberships"("userId", "status");
CREATE INDEX "teacher_group_assignments_groupId_status_idx" ON "teacher_group_assignments"("groupId", "status");
CREATE INDEX "teacher_group_assignments_teacherId_status_idx" ON "teacher_group_assignments"("teacherId", "status");

-- ───────────── Claves foráneas de auditoría (SetNull: el historial sobrevive al actor) ─────────────
ALTER TABLE "groups" ADD CONSTRAINT "groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teacher_group_assignments" ADD CONSTRAINT "teacher_group_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teacher_group_assignments" ADD CONSTRAINT "teacher_group_assignments_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════ Integridad que Prisma no expresa (SQL manual) ═════════════════

-- Sin duplicados ACTIVE: una única membresía / asignación vigente por par. Las filas históricas no cuentan.
CREATE UNIQUE INDEX "group_memberships_one_active_per_user_group"
    ON "group_memberships"("userId", "groupId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "teacher_group_assignments_one_active_per_teacher_group"
    ON "teacher_group_assignments"("teacherId", "groupId") WHERE "status" = 'ACTIVE';

-- Coherencia estado ↔ fecha de baja.
ALTER TABLE "groups" ADD CONSTRAINT "groups_status_consistency" CHECK (
    ("status" = 'ACTIVE' AND "deactivatedAt" IS NULL) OR ("status" = 'INACTIVE' AND "deactivatedAt" IS NOT NULL)
);
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_status_consistency" CHECK (
    ("status" = 'ACTIVE' AND "removedAt" IS NULL) OR ("status" = 'REMOVED' AND "removedAt" IS NOT NULL)
);
ALTER TABLE "teacher_group_assignments" ADD CONSTRAINT "teacher_group_assignments_status_consistency" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL) OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
);

-- Defensa en profundidad del rol del usuario (la aplicación ya lo valida): al INSERTAR, el estudiante de una
-- membresía debe tener rol STUDENT y el docente de una asignación, rol TEACHER. No se aplica a filas existentes.
CREATE FUNCTION enforce_membership_student_role() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."userId" AND "role" = 'STUDENT') THEN
        RAISE EXCEPTION 'group_memberships.userId debe referir a un usuario con rol STUDENT';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER group_memberships_student_role
    BEFORE INSERT ON "group_memberships"
    FOR EACH ROW EXECUTE FUNCTION enforce_membership_student_role();

CREATE FUNCTION enforce_assignment_teacher_role() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."teacherId" AND "role" = 'TEACHER') THEN
        RAISE EXCEPTION 'teacher_group_assignments.teacherId debe referir a un usuario con rol TEACHER';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER teacher_group_assignments_teacher_role
    BEFORE INSERT ON "teacher_group_assignments"
    FOR EACH ROW EXECUTE FUNCTION enforce_assignment_teacher_role();
