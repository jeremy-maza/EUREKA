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
