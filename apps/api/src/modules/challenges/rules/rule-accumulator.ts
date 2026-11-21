import { RuleDefinition } from './rule.types';

/**
 * Conjunto inmutable y ordenado de reglas desbloqueadas por un jugador en un mundo.
 * Solo crece: las reglas nunca se eliminan por fallar o reiniciar la secuencia
 * (únicamente un reinicio explícito del mundo parte de `RuleAccumulator.empty()`).
 */
export class RuleAccumulator {
  private constructor(private readonly unlocked: readonly RuleDefinition[]) {}

  static empty(): RuleAccumulator {
    return new RuleAccumulator([]);
  }

  static from(rules: readonly RuleDefinition[]): RuleAccumulator {
    return rules.reduce<RuleAccumulator>((acc, rule) => acc.unlock(rule), RuleAccumulator.empty());
  }

  /** Idempotente: desbloquear una regla ya activa devuelve la misma instancia. */
  unlock(rule: RuleDefinition): RuleAccumulator {
    return this.has(rule.id) ? this : new RuleAccumulator([...this.unlocked, rule]);
  }

  has(ruleId: string): boolean {
    return this.unlocked.some((rule) => rule.id === ruleId);
  }

  /** Reglas activas, en orden de desbloqueo. */
  get rules(): readonly RuleDefinition[] {
    return this.unlocked;
  }

  get count(): number {
    return this.unlocked.length;
  }
}
