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
  it('exige DATABASE_URL fuera de tests', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
    expect(validateEnv({ NODE_ENV: 'test' }).PORT).toBe(3000);
  });

  it('valida tipos y rangos con mensajes claros', () => {
    expect(() => validateEnv({ NODE_ENV: 'test', PORT: '99999' })).toThrow(/PORT/);
    expect(() => validateEnv({ NODE_ENV: 'test', GAME_BASE_TIME_SECONDS: '0' })).toThrow(
      /GAME_BASE_TIME_SECONDS/,
    );
    expect(() => validateEnv({ NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
    expect(() => validateEnv({ NODE_ENV: 'test', JWT_SECRET: 'corto' })).toThrow(/JWT_SECRET/);
  });

  it('acepta una configuración completa', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@h:5432/d',
      PORT: '8080',
    });
    expect(env.PORT).toBe(8080);
  });
});
