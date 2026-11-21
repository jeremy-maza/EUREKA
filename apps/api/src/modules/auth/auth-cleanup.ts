import type { AuthConfig } from '../../config/auth.config';
import type { DbClient, PrismaService } from '../../prisma/prisma.service';

export interface PurgeResult {
  sessions: number;
  resetTokens: number;
  throttles: number;
}

const DAY_MS = 24 * 3600 * 1000;
/** Contadores inactivos: más que cualquier ventana configurable (máx. 24 h). */
const THROTTLE_STALE_MS = DAY_MS;

type Db = Pick<DbClient, 'authSession' | 'passwordResetToken' | 'authThrottle'> | PrismaService;

/**
 * Purga SOLO registros caducados hace más de `AUTH_RETENTION_DAYS` (por defecto 30): el historial reciente de
 * sesiones y recuperaciones (incluidas las revocadas/consumidas) se conserva para auditoría. Nunca toca sesiones
 * vigentes ni tokens pendientes. Idempotente y segura de ejecutar en varias instancias a la vez.
 */
export async function purgeAuthRecords(
  db: Db,
  now: Date,
  retention: AuthConfig['retention'],
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - retention.days * DAY_MS);
  const throttleCutoff = new Date(now.getTime() - THROTTLE_STALE_MS);

  const sessions = await db.authSession.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  const resetTokens = await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  const throttles = await db.authThrottle.deleteMany({
    where: {
      lastAttemptAt: { lt: throttleCutoff },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
  });
  return { sessions: sessions.count, resetTokens: resetTokens.count, throttles: throttles.count };
}
