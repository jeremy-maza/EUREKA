import { createHash } from 'node:crypto';
import { ThrottleScope } from '../../generated/prisma/client';
import { normalizeEmail } from '../users';
import { normalizeClientIp } from './client-ip';
import type { ThrottleTarget } from './throttle.service';
import type { ThrottlePolicy } from './throttle-state';

export interface LoginThrottleConfig {
  ipEmail: ThrottlePolicy;
  email: ThrottlePolicy;
  ip: ThrottlePolicy;
}

/** SHA-256 del correo normalizado: clave estable que no almacena correos de cuentas que quizá no existan. */
export const emailThrottleKey = (email: string): string =>
  createHash('sha256').update(normalizeEmail(email)).digest('hex');

export const ipEmailThrottleKey = (rawIp: string | undefined, email: string): string =>
  `${normalizeClientIp(rawIp)}|${emailThrottleKey(email)}`;

/** Los tres contadores de un intento de login: IP, correo (cualquier IP) y par IP+correo. */
export function loginThrottleTargets(
  config: LoginThrottleConfig,
  rawIp: string | undefined,
  email: string,
): ThrottleTarget[] {
  return [
    { scope: ThrottleScope.LOGIN_IP, key: normalizeClientIp(rawIp), policy: config.ip },
    { scope: ThrottleScope.LOGIN_EMAIL, key: emailThrottleKey(email), policy: config.email },
    { scope: ThrottleScope.LOGIN_IP_EMAIL, key: ipEmailThrottleKey(rawIp, email), policy: config.ipEmail },
  ];
}
