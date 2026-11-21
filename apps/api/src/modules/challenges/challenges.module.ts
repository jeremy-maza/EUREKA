import { Module } from '@nestjs/common';
import { ChallengeEngine, createChallengeEngine } from './challenge-engine';
import { RuleEngine, createDefaultRuleEngine } from './rules';

/**
 * Registra el motor de retos/reglas. Las clases del motor son TypeScript puro (sin decoradores
 * de Nest) para poder probarlas sin infraestructura; aquí solo se conectan al contenedor de DI.
 */
@Module({
  providers: [
    { provide: RuleEngine, useFactory: createDefaultRuleEngine },
    {
      provide: ChallengeEngine,
      useFactory: (ruleEngine: RuleEngine) => createChallengeEngine(ruleEngine),
      inject: [RuleEngine],
    },
  ],
  exports: [RuleEngine, ChallengeEngine],
})
export class ChallengesModule {}
