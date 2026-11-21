import { Injectable } from '@nestjs/common';
import { Clock } from '../../common';
import { ThrottleScope } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  chargeAttempt,
  isLocked,
  secondsUntilUnlocked,
  ThrottlePolicy,
  ThrottleState,
} from './throttle-state';

export interface ThrottleTarget {
  scope: ThrottleScope;
  /** IP normalizada, SHA-256 del correo normalizado o id de usuario. Nunca datos en claro de cuentas inexistentes. */
  key: string;
  policy: ThrottlePolicy;
}

export interface ThrottleVerdict {
  allowed: boolean;
  /** Segundos hasta que expire el bloqueo más largo aplicable (0 si `allowed`). */
  retryAfterSeconds: number;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Limitador de intentos persistente en PostgreSQL (sin Redis). Diseño:
 *
 *  1. `charge` CUENTA el intento ANTES de verificar la credencial y bloquea las filas implicadas con
 *     `SELECT … FOR UPDATE` dentro de una transacción. Así, N peticiones concurrentes se serializan por contador y
 *     como máximo `maxAttempts` llegan a verificar la contraseña; no hay ventana entre "comprobar" e "incrementar".
 *  2. Si algún ámbito ya está bloqueado, se rechaza SIN contar (un atacante bloqueado no agota los contadores de la
 *     víctima en otros ámbitos).
 *  3. Las filas se bloquean siempre en el mismo orden (ámbito, clave): no hay interbloqueos entre transacciones.
 *  4. `release` devuelve el intento tras un éxito; `clear` borra el contador (éxito del par IP+correo, cambio de clave).
 *
 * El tiempo es el del servidor (`Clock`); la lógica de ventanas/bloqueos es pura (`throttle-state.ts`).
 */
@Injectable()
export class ThrottleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async charge(targets: ThrottleTarget[]): Promise<ThrottleVerdict> {
    // Orden determinista e independiente de la configuración regional (comparación por unidades de código).
    const ordered = [...targets].sort((a, b) => compareText(a.scope, b.scope) || compareText(a.key, b.key));
    const now = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      await tx.authThrottle.createMany({
        data: ordered.map(({ scope, key }) => ({
          scope,
          key,
          attempts: 0,
          windowStartedAt: now,
          lastAttemptAt: now,
        })),
        skipDuplicates: true,
      });

      for (const { scope, key } of ordered) {
        await tx.$queryRaw`SELECT 1 FROM auth_throttles WHERE scope = ${scope}::"ThrottleScope" AND key = ${key} FOR UPDATE`;
      }
      const rows = await tx.authThrottle.findMany({
        where: { OR: ordered.map(({ scope, key }) => ({ scope, key })) },
      });
      const stateOf = (target: ThrottleTarget): ThrottleState => {
        const row = rows.find((r) => r.scope === target.scope && r.key === target.key)!;
        return {
          attempts: row.attempts,
          windowStartedAt: row.windowStartedAt,
          lockLevel: row.lockLevel,
          lockedUntil: row.lockedUntil,
        };
      };

      // Ya bloqueado en algún ámbito: se rechaza sin contar.
      const locked = ordered.map(stateOf).filter((state) => isLocked(state, now));
      if (locked.length > 0) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(...locked.map((s) => secondsUntilUnlocked(s, now))),
        };
      }

      let retryAfterSeconds = 0;
      for (const target of ordered) {
        const next = chargeAttempt(stateOf(target), now, target.policy);
        await tx.authThrottle.update({
          where: { scope_key: { scope: target.scope, key: target.key } },
          data: { ...next, lastAttemptAt: now },
        });
        retryAfterSeconds = Math.max(retryAfterSeconds, secondsUntilUnlocked(next, now));
      }
      return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
    });
  }

  /** Devuelve un intento contado (éxito de la credencial). Atómico, sin lectura previa. */
  async release(scope: ThrottleScope, key: string): Promise<void> {
    await this.prisma
      .$executeRaw`UPDATE auth_throttles SET attempts = GREATEST(attempts - 1, 0) WHERE scope = ${scope}::"ThrottleScope" AND key = ${key}`;
  }

  async clear(scope: ThrottleScope, key: string): Promise<void> {
    await this.prisma.authThrottle.deleteMany({ where: { scope, key } });
  }
}
