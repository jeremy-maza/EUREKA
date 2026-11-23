import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import gameConfig from '../../config/game.config';
import { ChallengeEngine, ChallengesModule } from '../challenges';
import { ProgressionManager, ProgressionModule } from '../progression';
import { StatisticsModule } from '../statistics';
import { ScoringEngine, ScoringModule } from '../scoring';
import { planSequence } from '../sequences';
import { WorldsModule } from '../worlds';
import { adaptiveDifficultyPolicy } from './difficulty';
import { GameController } from './game.controller';
import { GameEngine } from './game-engine';
import { GameService } from './game.service';
import { LeaderboardService } from './leaderboard.service';
import { PlayerStateController } from './player-state.controller';
import { PlayerStateService } from './player-state.service';
import { ProgressViewBuilder } from './progress-view.builder';
import { DIFFICULTY_POLICY, SEQUENCE_PLANNER, SequenceStore } from './sequence-store';
import { TimerManager } from './timer-manager';
import { WorldUnlockService } from './world-unlocks.service';

@Module({
  imports: [ChallengesModule, ProgressionModule, ScoringModule, StatisticsModule, WorldsModule],
  controllers: [GameController, PlayerStateController],
  providers: [
    GameService,
    PlayerStateService,
    LeaderboardService,
    ProgressViewBuilder,
    SequenceStore,
    WorldUnlockService,
    { provide: DIFFICULTY_POLICY, useValue: adaptiveDifficultyPolicy },
    { provide: SEQUENCE_PLANNER, useValue: planSequence },
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
  exports: [GameEngine, TimerManager, WorldUnlockService],
})
export class GameModule {}
