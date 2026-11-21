/**
 * Lógica PURA (sin BD ni reloj propio) del limitador de intentos: ventana deslizante simple con bloqueo
 * temporal progresivo. La persistencia y la atomicidad viven en `ThrottleService`.
 *
 *  - Se permiten `maxAttempts` intentos por ventana; el siguiente (`maxAttempts + 1`) se rechaza y abre un bloqueo.
 *  - El bloqueo dura `lockBaseSeconds · 2^(nivel-1)` con tope `lockMaxSeconds`; el nivel sube con cada bloqueo
 *    consecutivo y se olvida tras una ventana completa sin actividad posterior al fin del bloqueo.
 *  - Nunca hay bloqueo permanente: todo bloqueo expira solo.
 */
export interface ThrottlePolicy {
  maxAttempts: number;
  windowSeconds: number;
  lockBaseSeconds: number;
  lockMaxSeconds: number;
}

export interface ThrottleState {
  attempts: number;
  windowStartedAt: Date;
  lockLevel: number;
  lockedUntil: Date | null;
}

/** Tope del nivel de bloqueo: evita desbordar la columna y `2 ** n` con muchos bloqueos seguidos. */
const MAX_LOCK_LEVEL = 30;

export function isLocked(state: Pick<ThrottleState, 'lockedUntil'> | null, now: Date): boolean {
  return state?.lockedUntil != null && state.lockedUntil.getTime() > now.getTime();
}

/** Segundos (redondeados hacia arriba) que faltan para que expire el bloqueo; 0 si no hay. */
export function secondsUntilUnlocked(state: Pick<ThrottleState, 'lockedUntil'> | null, now: Date): number {
  if (!state?.lockedUntil) return 0;
  return Math.max(0, Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000));
}

/**
 * Cuenta un intento. Precondición: el estado NO está bloqueado en `now` (quien llama lo comprueba antes).
 * Devuelve el nuevo estado; si `lockedUntil` queda en el futuro, este intento acaba de provocar el bloqueo.
 */
export function chargeAttempt(state: ThrottleState | null, now: Date, policy: ThrottlePolicy): ThrottleState {
  const windowMs = policy.windowSeconds * 1000;
  let { attempts, windowStartedAt, lockLevel } = state ?? { attempts: 0, windowStartedAt: now, lockLevel: 0 };
  const lockedUntil = state?.lockedUntil ?? null;

  if (!state || windowStartedAt.getTime() + windowMs <= now.getTime()) {
    const quiet = lockedUntil === null || lockedUntil.getTime() + windowMs <= now.getTime();
    attempts = 0;
    windowStartedAt = now;
    if (quiet) lockLevel = 0;
  }

  attempts += 1;
  if (attempts > policy.maxAttempts) {
    lockLevel = Math.min(lockLevel + 1, MAX_LOCK_LEVEL);
    const seconds = Math.min(policy.lockBaseSeconds * 2 ** (lockLevel - 1), policy.lockMaxSeconds);
    return {
      attempts: 0,
      windowStartedAt: now,
      lockLevel,
      lockedUntil: new Date(now.getTime() + seconds * 1000),
    };
  }
  return { attempts, windowStartedAt, lockLevel, lockedUntil };
}
