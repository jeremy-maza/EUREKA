import { registerAs } from '@nestjs/config';
import type { ThrottlePolicy } from '../modules/auth/throttle-state';

/** Token de inyección de la configuración de autenticación ya resuelta (`AuthConfig`). */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export type MailTransport = 'disabled' | 'console';

export interface AuthConfig {
  password: { minLength: number; maxLength: number };
  login: { ipEmail: ThrottlePolicy; email: ThrottlePolicy; ip: ThrottlePolicy };
  passwordChange: ThrottlePolicy;
  passwordReset: {
    ttlSeconds: number;
    cooldownSeconds: number;
    requestsPerIp: ThrottlePolicy;
    /** URL del frontend a la que se añade `#token=…` en el correo. */
    urlBase: string;
  };
  retention: { days: number; cleanupIntervalMinutes: number };
  mail: { transport: MailTransport };
}

export const MAX_PASSWORD_LENGTH = 128;

function numberFrom(value: string | undefined, fallback: number): number {
  return value === undefined || value.trim() === '' ? fallback : Number(value);
}

/**
 * Configuración de autenticación desde variables de entorno (valores por defecto = recomendados para producción).
 * Los rangos se validan en `env.validation.ts`; aquí solo se aplican los valores por defecto.
 */
export function buildAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const windowSeconds = numberFrom(env.LOGIN_WINDOW_SECONDS, 900);
  const lockBaseSeconds = numberFrom(env.LOGIN_LOCK_BASE_SECONDS, 60);
  const lockMaxSeconds = numberFrom(env.LOGIN_LOCK_MAX_SECONDS, 900);
  const loginPolicy = (maxAttempts: number): ThrottlePolicy => ({
    maxAttempts,
    windowSeconds,
    lockBaseSeconds,
    lockMaxSeconds,
  });

  const corsOrigin = (env.CORS_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '');
  return {
    password: { minLength: numberFrom(env.PASSWORD_MIN_LENGTH, 8), maxLength: MAX_PASSWORD_LENGTH },
    login: {
      ipEmail: loginPolicy(numberFrom(env.LOGIN_MAX_ATTEMPTS_IP_EMAIL, 5)),
      email: loginPolicy(numberFrom(env.LOGIN_MAX_ATTEMPTS_EMAIL, 20)),
      ip: loginPolicy(numberFrom(env.LOGIN_MAX_ATTEMPTS_IP, 100)),
    },
    passwordChange: loginPolicy(numberFrom(env.PASSWORD_CHANGE_MAX_ATTEMPTS, 5)),
    passwordReset: {
      ttlSeconds: numberFrom(env.PASSWORD_RESET_TTL_MINUTES, 30) * 60,
      cooldownSeconds: numberFrom(env.PASSWORD_RESET_COOLDOWN_SECONDS, 60),
      requestsPerIp: {
        maxAttempts: numberFrom(env.PASSWORD_RESET_MAX_REQUESTS_PER_IP, 10),
        windowSeconds: 3600,
        lockBaseSeconds: 900,
        lockMaxSeconds: 3600,
      },
      urlBase: env.PASSWORD_RESET_URL?.trim() || `${corsOrigin}/reset-password`,
    },
    retention: {
      days: numberFrom(env.AUTH_RETENTION_DAYS, 30),
      cleanupIntervalMinutes: numberFrom(env.AUTH_CLEANUP_INTERVAL_MINUTES, 360),
    },
    mail: { transport: (env.MAIL_TRANSPORT?.trim() || 'disabled') as MailTransport },
  };
}

/** Valor de `TRUST_PROXY` → opción `trust proxy` de Express (false por defecto: no se confía en `X-Forwarded-For`). */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  const raw = value?.trim();
  if (!raw || raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw; // 'loopback', CIDR o lista separada por comas: los interpreta Express
}

export default registerAs('auth', () => buildAuthConfig());
