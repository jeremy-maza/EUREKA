/**
 * Errores de *configuración* de reglas (datos de catálogo mal formados).
 * A diferencia de `MathError`, indican un defecto del sistema, no un error del jugador.
 */
export class RuleConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnknownRuleTypeError extends RuleConfigurationError {
  constructor(
    readonly ruleType: string,
    readonly ruleId: string,
  ) {
    super(`La regla "${ruleId}" usa el tipo desconocido "${ruleType}".`);
  }
}

export class InvalidRuleConfigError extends RuleConfigurationError {
  constructor(ruleType: string, detail: string) {
    super(`Configuración inválida para la regla ${ruleType}: ${detail}`);
  }
}
