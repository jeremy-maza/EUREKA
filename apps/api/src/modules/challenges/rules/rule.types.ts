import { ExpressionNode } from '../math';

/** Configuración serializable (JSON) de una regla. */
export type RuleConfig = Record<string, unknown>;

/**
 * Definición estructurada de una regla: tipo + descripción + configuración.
 * Es independiente de los retos (un reto solo *referencia* la regla que introduce).
 */
export interface RuleDefinition {
  /** Identificador estable (clave de catálogo), p. ej. "arithmetic.forbidden-digit-2". */
  id: string;
  /** Tipo que selecciona el `RuleHandler` (FORBIDDEN_DIGIT, REQUIRED_OPERATION, …). */
  type: string;
  /** Texto para el jugador. */
  description: string;
  config: RuleConfig;
}

/** Lo que una regla puede inspeccionar de la respuesta (solo la expresión, no el `= resultado`). */
export interface RuleValidationContext {
  expression: ExpressionNode;
}

export interface RuleViolation {
  ruleId: string;
  ruleType: string;
  description: string;
  /** Explicación concreta de por qué la respuesta incumple la regla. */
  message: string;
}

/**
 * Contrato para añadir un nuevo tipo de regla sin tocar el `RuleEngine`:
 * implementar esta interfaz y registrarla.
 */
export interface RuleHandler<TConfig = unknown> {
  readonly type: string;
  /** Valida y tipa la configuración cruda. @throws InvalidRuleConfigError */
  parseConfig(raw: RuleConfig): TConfig;
  /** Devuelve el mensaje de violación, o `null` si la respuesta cumple la regla. */
  check(config: TConfig, context: RuleValidationContext): string | null;
}
