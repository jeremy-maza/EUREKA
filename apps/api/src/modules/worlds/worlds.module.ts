import { Module, OnModuleInit } from '@nestjs/common';
import { ChallengeEngine, ChallengesModule, RuleEngine } from '../challenges';
import { arithmeticWorld } from './catalog/arithmetic.world';
import { validateWorldDefinition } from './world-validator';
import { WorldCatalog } from './worlds.service';

@Module({
  imports: [ChallengesModule],
  providers: [{ provide: WorldCatalog, useFactory: () => new WorldCatalog([arithmeticWorld]) }],
  exports: [WorldCatalog],
})
export class WorldsModule implements OnModuleInit {
  constructor(
    private readonly catalog: WorldCatalog,
    private readonly ruleEngine: RuleEngine,
    private readonly challengeEngine: ChallengeEngine,
  ) {}

  /** Falla al arrancar si algún mundo del catálogo es inválido o tiene retos irresolubles. */
  onModuleInit(): void {
    for (const world of this.catalog.list()) {
      validateWorldDefinition(world, { ruleEngine: this.ruleEngine, challengeEngine: this.challengeEngine });
    }
  }
}
