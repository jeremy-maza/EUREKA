import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import gameConfig from '../../config/game.config';
import { ScoringEngine } from './scoring-engine';
import { StreakManager } from './streak-manager';

@Module({
  providers: [
    {
      provide: StreakManager,
      useFactory: (config: ConfigType<typeof gameConfig>) => new StreakManager(config.streak),
      inject: [gameConfig.KEY],
    },
    {
      provide: ScoringEngine,
      useFactory: (config: ConfigType<typeof gameConfig>, streaks: StreakManager) =>
        new ScoringEngine(config.scoring, streaks),
      inject: [gameConfig.KEY, StreakManager],
    },
  ],
  exports: [StreakManager, ScoringEngine],
})
export class ScoringModule {}
