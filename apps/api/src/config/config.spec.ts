import { buildAuthConfig, parseTrustProxy } from './auth.config';
import { buildGameConfig } from './game.config';
import { validateEnv } from './env.validation';

describe('buildGameConfig', () => {
  it('usa los valores por defecto del enunciado', () => {
    expect(buildGameConfig({})).toEqual({
      timer: { baseTimeSeconds: 60, additionalTimePerRuleSeconds: 15 },
      scoring: { basePoints: 100 },
      streak: { multiplierStepMilli: 500, maxMultiplierMilli: 5000 },
    });
  });

  it('lee la configuración del entorno y convierte multiplicadores a milésimas enteras', () => {
    const config = buildGameConfig({
      GAME_BASE_TIME_SECONDS: '45',
      GAME_ADDITIONAL_TIME_PER_RULE_SECONDS: '10',
      GAME_BASE_POINTS: '50',
      GAME_STREAK_MULTIPLIER_STEP: '0.25',
      GAME_MAX_STREAK_MULTIPLIER: '3',
    });
    expect(config.timer).toEqual({ baseTimeSeconds: 45, additionalTimePerRuleSeconds: 10 });
    expect(config.scoring.basePoints).toBe(50);
    expect(config.streak).toEqual({ multiplierStepMilli: 250, maxMultiplierMilli: 3000 });
  });
});

describe('validateEnv', () => {
  const SECRET = 'x'.repeat(32);

  it('exige DATABASE_URL fuera de tests', () => {
    expect(() => validateEnv({ NODE_ENV: 'development', JWT_SECRET: SECRET })).toThrow(/DATABASE_URL/);
    expect(validateEnv({ NODE_ENV: 'test', JWT_SECRET: SECRET }).PORT).toBe(3000);
  });

  it('exige un JWT_SECRET de al menos 32 caracteres', () => {
    expect(() => validateEnv({ NODE_ENV: 'test' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ NODE_ENV: 'test', JWT_SECRET: 'corto' })).toThrow(/JWT_SECRET/);
  });

  it('valida tipos y rangos con mensajes claros', () => {
    const base = { NODE_ENV: 'test', JWT_SECRET: SECRET };
    expect(() => validateEnv({ ...base, PORT: '99999' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base, GAME_BASE_TIME_SECONDS: '0' })).toThrow(/GAME_BASE_TIME_SECONDS/);
    expect(() => validateEnv({ ...base, JWT_EXPIRES_IN_SECONDS: '5' })).toThrow(/JWT_EXPIRES_IN_SECONDS/);
    expect(() => validateEnv({ ...base, DATABASE_POOL_MAX: '0' })).toThrow(/DATABASE_POOL_MAX/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });

  it('rechaza en producción el secreto de ejemplo de .env.example', () => {
    const env = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@h:5432/d' };
    expect(() => validateEnv({ ...env, JWT_SECRET: `dev-only-${'x'.repeat(30)}` })).toThrow(
      /ejemplo en producción/,
    );
    expect(() => validateEnv({ ...env, JWT_SECRET: SECRET })).not.toThrow();
  });

  it('acepta una configuración completa', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@h:5432/d',
      PORT: '8080',
      JWT_SECRET: SECRET,
      JWT_EXPIRES_IN_SECONDS: '900',
      DATABASE_POOL_MAX: '20',
    });
    expect(env).toMatchObject({ PORT: 8080, JWT_EXPIRES_IN_SECONDS: 900, DATABASE_POOL_MAX: 20 });
  });
});

describe('buildAuthConfig', () => {
  it('usa los valores recomendados para producción por defecto', () => {
    const config = buildAuthConfig({});
    expect(config.password).toEqual({ minLength: 8, maxLength: 128 });
    expect(config.login.ipEmail).toEqual({
      maxAttempts: 5,
      windowSeconds: 900,
      lockBaseSeconds: 60,
      lockMaxSeconds: 900,
    });
    expect(config.login.email.maxAttempts).toBe(20);
    expect(config.login.ip.maxAttempts).toBe(100);
    expect(config.passwordChange.maxAttempts).toBe(5);
    expect(config.passwordReset).toMatchObject({
      ttlSeconds: 1800,
      cooldownSeconds: 60,
      urlBase: 'http://localhost:5173/reset-password',
    });
    expect(config.passwordReset.requestsPerIp.maxAttempts).toBe(10);
    expect(config.retention).toEqual({ days: 30, cleanupIntervalMinutes: 360 });
    expect(config.mail.transport).toBe('disabled');
  });

  it('lee todo del entorno', () => {
    const config = buildAuthConfig({
      PASSWORD_MIN_LENGTH: '12',
      LOGIN_MAX_ATTEMPTS_IP_EMAIL: '3',
      LOGIN_MAX_ATTEMPTS_EMAIL: '10',
      LOGIN_MAX_ATTEMPTS_IP: '50',
      LOGIN_WINDOW_SECONDS: '300',
      LOGIN_LOCK_BASE_SECONDS: '30',
      LOGIN_LOCK_MAX_SECONDS: '600',
      PASSWORD_RESET_TTL_MINUTES: '15',
      PASSWORD_RESET_URL: 'https://app.example.com/restablecer',
      MAIL_TRANSPORT: 'console',
      AUTH_RETENTION_DAYS: '90',
    });
    expect(config.password.minLength).toBe(12);
    expect(config.login.ipEmail).toEqual({
      maxAttempts: 3,
      windowSeconds: 300,
      lockBaseSeconds: 30,
      lockMaxSeconds: 600,
    });
    expect(config.login.ip.maxAttempts).toBe(50);
    expect(config.passwordReset.ttlSeconds).toBe(900);
    expect(config.passwordReset.urlBase).toBe('https://app.example.com/restablecer');
    expect(config.mail.transport).toBe('console');
    expect(config.retention.days).toBe(90);
  });

  it('deriva la URL de recuperación de CORS_ORIGIN sin barra final', () => {
    expect(buildAuthConfig({ CORS_ORIGIN: 'https://app.example.com/' }).passwordReset.urlBase).toBe(
      'https://app.example.com/reset-password',
    );
  });
});

describe('parseTrustProxy', () => {
  it('no confía en proxies por defecto', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('interpreta saltos, booleano y listas', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});

describe('validateEnv (autenticación)', () => {
  const base = { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32) };

  it('valida rangos de la política de contraseñas, el limitador y la recuperación', () => {
    expect(() => validateEnv({ ...base, PASSWORD_MIN_LENGTH: '4' })).toThrow(/PASSWORD_MIN_LENGTH/);
    expect(() => validateEnv({ ...base, PASSWORD_MIN_LENGTH: '65' })).toThrow(/PASSWORD_MIN_LENGTH/);
    expect(() => validateEnv({ ...base, LOGIN_MAX_ATTEMPTS_IP_EMAIL: '0' })).toThrow(
      /LOGIN_MAX_ATTEMPTS_IP_EMAIL/,
    );
    expect(() => validateEnv({ ...base, LOGIN_WINDOW_SECONDS: '1' })).toThrow(/LOGIN_WINDOW_SECONDS/);
    expect(() => validateEnv({ ...base, PASSWORD_RESET_TTL_MINUTES: '1' })).toThrow(
      /PASSWORD_RESET_TTL_MINUTES/,
    );
    expect(() => validateEnv({ ...base, PASSWORD_RESET_URL: 'no-es-url' })).toThrow(/PASSWORD_RESET_URL/);
    expect(() => validateEnv({ ...base, MAIL_TRANSPORT: 'smtp' })).toThrow(/MAIL_TRANSPORT/);
    expect(() => validateEnv({ ...base, AUTH_CLEANUP_INTERVAL_MINUTES: '-1' })).toThrow(
      /AUTH_CLEANUP_INTERVAL_MINUTES/,
    );
  });

  it('rechaza un bloqueo base mayor que el máximo', () => {
    expect(() =>
      validateEnv({ ...base, LOGIN_LOCK_BASE_SECONDS: '600', LOGIN_LOCK_MAX_SECONDS: '60' }),
    ).toThrow(/LOGIN_LOCK_BASE_SECONDS/);
  });

  it('MAIL_TRANSPORT=console no se permite en producción (imprimiría tokens)', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@h:5432/d',
      JWT_SECRET: 'x'.repeat(32),
    };
    expect(() => validateEnv({ ...prod, MAIL_TRANSPORT: 'console' })).toThrow(/producción/);
    expect(() => validateEnv({ ...prod, MAIL_TRANSPORT: 'disabled' })).not.toThrow();
    expect(() => validateEnv({ ...base, MAIL_TRANSPORT: 'console' })).not.toThrow();
  });

  it('acepta una configuración de autenticación completa', () => {
    const env = validateEnv({
      ...base,
      TRUST_PROXY: '1',
      PASSWORD_MIN_LENGTH: '12',
      LOGIN_MAX_ATTEMPTS_IP: '200',
      PASSWORD_RESET_URL: 'https://app.example.com/reset-password',
    });
    expect(env).toMatchObject({ PASSWORD_MIN_LENGTH: 12, LOGIN_MAX_ATTEMPTS_IP: 200, TRUST_PROXY: '1' });
  });
});
