import { ChallengeDefinition, RuleDefinition } from '../challenges';

/** Catálogo de un mundo: reglas y retos por separado, enlazados por `introducesRuleId`. */
export interface WorldDefinition {
  slug: string;
  name: string;
  description: string;
  /** Orden de presentación (1 = Aritmética). */
  position: number;
  rules: readonly RuleDefinition[];
  /** Secuencia ordenada de retos. */
  challenges: readonly ChallengeDefinition[];
}
