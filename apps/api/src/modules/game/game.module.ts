import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import gameConfig from '../../config/game.config';
import { ChallengeEngine, ChallengesModule } from '../challenges';
import { ProgressionManager, ProgressionModule } from '../progression';
import { StatisticsModule } from '../statistics';
import { ScoringEngine, ScoringModule } from '../scoring';
import { WorldsModule } from '../worlds';
import { GameController } from './game.controller';
import { GameEngine } from './game-engine';
import { GameService } from './game.service';
import { LeaderboardService } from './leaderboard.service';
import { PlayerStateController } from './player-state.controller';
import { PlayerStateService } from './player-state.service';
import { ProgressViewBuilder } from './progress-view.builder';
import { TimerManager } from './timer-manager';

@Module({
  imports: [ChallengesModule, ProgressionModule, ScoringModule, StatisticsModule, WorldsModule],
  controllers: [GameController, PlayerStateController],
  providers: [
    GameService,
    PlayerStateService,
    LeaderboardService,
    ProgressViewBuilder,
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
