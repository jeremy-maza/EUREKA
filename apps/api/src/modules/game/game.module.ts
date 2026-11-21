import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import gameConfig from '../../config/game.config';
import { ChallengeEngine, ChallengesModule } from '../challenges';
import { ProgressionManager, ProgressionModule } from '../progression';
import { ScoringEngine, ScoringModule } from '../scoring';
import { WorldsModule } from '../worlds';
import { GameEngine } from './game-engine';
import { TimerManager } from './timer-manager';

@Module({
  imports: [ChallengesModule, ProgressionModule, ScoringModule, WorldsModule],
  providers: [
    {
      provide: TimerManager,
      useFactory: (config: ConfigType<typeof gameConfig>) => new TimerManager(config.timer),
      inject: [gameConfig.KEY],
    },
    {
      provide: GameEngine,
      useFactory: (
        challengeEngine: ChallengeEngine,
        timerManager: TimerManager,
        scoringEngine: ScoringEngine,
        progressionManager: ProgressionManager,
      ) => new GameEngine({ challengeEngine, timerManager, scoringEngine, progressionManager }),
      inject: [ChallengeEngine, TimerManager, ScoringEngine, ProgressionManager],
    },
  ],
  exports: [GameEngine, TimerManager],
})
export class GameModule {}
