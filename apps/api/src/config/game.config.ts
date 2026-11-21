import { registerAs } from '@nestjs/config';
import { DEFAULT_SCORING_CONFIG, ScoringConfig } from '../modules/scoring/scoring-engine';
import { DEFAULT_STREAK_CONFIG, StreakConfig } from '../modules/scoring/streak-manager';
import { DEFAULT_TIMER_CONFIG, TimerConfig } from '../modules/game/timer-manager';

export interface GameConfig {
  timer: TimerConfig;
  scoring: ScoringConfig;
  streak: StreakConfig;
}

function numberFrom(value: string | undefined, fallback: number): number {
  return value === undefined || value.trim() === '' ? fallback : Number(value);
}

/**
 * Construye la configuración del juego desde variables de entorno (con valores por defecto).
 * El multiplicador se lee en decimales (0.5, 5) y se convierte UNA vez a milésimas enteras.
 */
export function buildGameConfig(env: NodeJS.ProcessEnv = process.env): GameConfig {
  return {
    timer: {
      baseTimeSeconds: numberFrom(env.GAME_BASE_TIME_SECONDS, DEFAULT_TIMER_CONFIG.baseTimeSeconds),
      additionalTimePerRuleSeconds: numberFrom(
        env.GAME_ADDITIONAL_TIME_PER_RULE_SECONDS,
        DEFAULT_TIMER_CONFIG.additionalTimePerRuleSeconds,
      ),
    },
    scoring: { basePoints: numberFrom(env.GAME_BASE_POINTS, DEFAULT_SCORING_CONFIG.basePoints) },
    streak: {
      multiplierStepMilli: Math.round(
        numberFrom(env.GAME_STREAK_MULTIPLIER_STEP, DEFAULT_STREAK_CONFIG.multiplierStepMilli / 1000) * 1000,
      ),
      maxMultiplierMilli: Math.round(
        numberFrom(env.GAME_MAX_STREAK_MULTIPLIER, DEFAULT_STREAK_CONFIG.maxMultiplierMilli / 1000) * 1000,
      ),
    },
  };
}

export default registerAs('game', () => buildGameConfig());
