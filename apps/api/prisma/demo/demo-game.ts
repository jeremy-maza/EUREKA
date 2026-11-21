/**
 * Cableado manual (sin contenedor de Nest) del `GameService` REAL con un reloj controlable.
 *
 * Los fixtures de demostración se generan jugando de verdad contra el motor: intentos, libro de puntos,
 * estadísticas y reglas desbloqueadas salen de las mismas reglas del juego, nunca de filas escritas a mano.
 * Se evita el contenedor de DI porque `tsx` no emite metadatos de decoradores.
 */
import { Clock } from '../../src/common/clock';
import { buildGameConfig } from '../../src/config/game.config';
import { createChallengeEngine, createDefaultRuleEngine } from '../../src/modules/challenges';
import { GameEngine } from '../../src/modules/game/game-engine';
import { GameService } from '../../src/modules/game/game.service';
import { ProgressViewBuilder } from '../../src/modules/game/progress-view.builder';
import { TimerManager } from '../../src/modules/game/timer-manager';
import { ProgressionManager } from '../../src/modules/progression/progression-manager';
import { ProgressionService } from '../../src/modules/progression/progression.service';
import { ScoreService } from '../../src/modules/scoring/score.service';
import { ScoringEngine } from '../../src/modules/scoring/scoring-engine';
import { StreakManager } from '../../src/modules/scoring/streak-manager';
import { StatisticsService } from '../../src/modules/statistics/statistics.service';
import { WorldsRepository } from '../../src/modules/worlds/worlds.repository';
import type { PrismaService } from '../../src/prisma/prisma.service';

/** Reloj del seeder: se coloca en el pasado para que el historial parezca real. */
export class DemoClock extends Clock {
  constructor(private current: Date) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

export function createDemoGameService(
  prisma: unknown,
  clock: Clock,
  env: NodeJS.ProcessEnv = process.env,
): GameService {
  const config = buildGameConfig(env);
  const db = prisma as PrismaService; // un PrismaClient plano basta: el servicio solo usa la API de consultas
  const ruleEngine = createDefaultRuleEngine();
  const challengeEngine = createChallengeEngine(ruleEngine);
  const streaks = new StreakManager(config.streak);
  const progressionManager = new ProgressionManager();
  const engine = new GameEngine({
    challengeEngine,
    timerManager: new TimerManager(config.timer),
    scoringEngine: new ScoringEngine(config.scoring, streaks),
    progressionManager,
  });
  const progression = new ProgressionService(db, progressionManager);
  const statistics = new StatisticsService(db);
  return new GameService(
    db,
    clock,
    new WorldsRepository(db, ruleEngine, challengeEngine),
    engine,
    progression,
    progressionManager,
    new ScoreService(db),
    statistics,
    new ProgressViewBuilder(progression, statistics, streaks),
  );
}
