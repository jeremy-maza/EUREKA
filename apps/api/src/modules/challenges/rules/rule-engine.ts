import { forbiddenDigitRule } from './handlers/forbidden-digit.rule';
import { requiredOperationRule } from './handlers/required-operation.rule';
import { RuleConfigurationError, UnknownRuleTypeError } from './rule.errors';
import { RuleDefinition, RuleHandler, RuleValidationContext, RuleViolation } from './rule.types';

/**
 * Valida respuestas contra un conjunto de reglas. No conoce ningún tipo concreto:
 * delega en el `RuleHandler` registrado para `rule.type`. Para añadir un tipo de regla
 * basta con registrar un handler nuevo (principio abierto/cerrado).
 */
export class RuleEngine {
  private readonly handlers = new Map<string, RuleHandler<unknown>>();

  constructor(handlers: readonly RuleHandler<any>[] = []) {
    handlers.forEach((handler) => this.register(handler));
  }

  register<TConfig>(handler: RuleHandler<TConfig>): this {
    if (this.handlers.has(handler.type)) {
      throw new RuleConfigurationError(`Ya existe un handler para el tipo de regla "${handler.type}".`);
    }
    this.handlers.set(handler.type, handler as RuleHandler<unknown>);
    return this;
  }

  supports(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * Comprueba que la definición es utilizable (tipo conocido y configuración válida).
   * @throws RuleConfigurationError
   */
  assertValidDefinition(rule: RuleDefinition): void {
    if (rule.id.trim().length === 0) {
      throw new RuleConfigurationError('Una regla debe tener un id no vacío.');
    }
    this.handlerFor(rule).parseConfig(rule.config);
  }

  /** Devuelve una violación por cada regla incumplida (lista vacía = cumple todas). */
  validate(rules: readonly RuleDefinition[], context: RuleValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    for (const rule of rules) {
      const handler = this.handlerFor(rule);
      const message = handler.check(handler.parseConfig(rule.config), context);
      if (message !== null) {
        violations.push({
          ruleId: rule.id,
          ruleType: rule.type,
          description: rule.description,
          message,
        });
      }
    }
    return violations;
  }

  private handlerFor(rule: RuleDefinition): RuleHandler<unknown> {
    const handler = this.handlers.get(rule.type);
    if (!handler) throw new UnknownRuleTypeError(rule.type, rule.id);
    return handler;
  }
}

/** Motor con los tipos de regla disponibles en el MVP. */
export function createDefaultRuleEngine(): RuleEngine {
  return new RuleEngine([forbiddenDigitRule, requiredOperationRule]);
}
