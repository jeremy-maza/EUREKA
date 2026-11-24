/**
 * Cableado manual (sin contenedor de Nest) del `GameService` REAL con un reloj controlable.
 *
 * Los fixtures de demostración se generan jugando de verdad contra el motor: intentos, libro de puntos,
 * estadísticas, secuencias y reglas dominadas salen de las mismas reglas del juego, nunca de filas escritas a mano.
 * Las semillas de las secuencias son deterministas (`SeedSource` del llamador) y el planificador es el real.
 * Se evita el contenedor de DI porque `tsx` no emite metadatos de decoradores.
 */
import { Clock } from '../../src/common/clock';
import { SeedSource } from '../../src/common/seed-source';
import { buildGameConfig } from '../../src/config/game.config';
import { createChallengeEngine, createDefaultRuleEngine } from '../../src/modules/challenges';
import { adaptiveDifficultyPolicy } from '../../src/modules/game/difficulty';
import { GameEngine } from '../../src/modules/game/game-engine';
import { GameService } from '../../src/modules/game/game.service';
import { ProgressViewBuilder } from '../../src/modules/game/progress-view.builder';
import { SequenceStore } from '../../src/modules/game/sequence-store';
import { TimerManager } from '../../src/modules/game/timer-manager';
import { WorldUnlockService } from '../../src/modules/game/world-unlocks.service';
import { ProgressionManager } from '../../src/modules/progression/progression-manager';
import { ProgressionService } from '../../src/modules/progression/progression.service';
import { ScoreService } from '../../src/modules/scoring/score.service';
import { ScoringEngine } from '../../src/modules/scoring/scoring-engine';
import { StreakManager } from '../../src/modules/scoring/streak-manager';
import { StatisticsService } from '../../src/modules/statistics/statistics.service';
import { planSequence } from '../../src/modules/sequences/sequence-planner';
import { ALL_WORLDS } from '../../src/modules/worlds/catalog';
import { WorldsRepository } from '../../src/modules/worlds/worlds.repository';
import { WorldCatalog } from '../../src/modules/worlds/worlds.service';
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
  seeds: SeedSource,
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
  const worlds = new WorldsRepository(db, new WorldCatalog(ALL_WORLDS));
  const unlocks = new WorldUnlockService(db, worlds, progression);
  return new GameService(
    db,
    clock,
    worlds,
    engine,
    progression,
    progressionManager,
    new ScoreService(db),
    statistics,
    new ProgressViewBuilder(progression, statistics, streaks, unlocks),
    new SequenceStore(clock, seeds, adaptiveDifficultyPolicy, planSequence),
    unlocks,
  );
}
