import { Module, OnModuleInit } from '@nestjs/common';
import { ChallengeEngine, ChallengesModule, RuleEngine } from '../challenges';
import { ALL_WORLDS } from './catalog';
import { validateWorldDefinition } from './world-validator';
import { WorldsController } from './worlds.controller';
import { WorldsRepository } from './worlds.repository';
import { WorldCatalog } from './worlds.service';

@Module({
  imports: [ChallengesModule],
  controllers: [WorldsController],
  providers: [{ provide: WorldCatalog, useFactory: () => new WorldCatalog(ALL_WORLDS) }, WorldsRepository],
  exports: [WorldCatalog, WorldsRepository],
})
export class WorldsModule implements OnModuleInit {
  constructor(
    private readonly catalog: WorldCatalog,
    private readonly ruleEngine: RuleEngine,
    private readonly challengeEngine: ChallengeEngine,
  ) {}

  /** Falla al arrancar si algún mundo del catálogo es inválido o no se puede planificar. */
  onModuleInit(): void {
    for (const world of this.catalog.list()) {
      validateWorldDefinition(world, { ruleEngine: this.ruleEngine, challengeEngine: this.challengeEngine });
    }
  }
}
