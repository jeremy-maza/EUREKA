/** Error base del motor matemático. Son errores del *jugador* (entrada inválida), no bugs. */
export class MathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DivisionByZeroError extends MathError {
  constructor() {
    super('No se puede dividir entre cero.');
  }
}

export type SyntaxErrorCode =
  | 'EMPTY_EXPRESSION'
  | 'EXPRESSION_TOO_LONG'
  | 'UNEXPECTED_CHARACTER'
  | 'DECIMALS_NOT_SUPPORTED'
  | 'INVALID_NUMBER'
  | 'VARIABLE_NOT_ALLOWED'
  | 'UNEXPECTED_TOKEN'
  | 'UNEXPECTED_END'
  | 'UNBALANCED_PARENTHESES'
  | 'INVALID_CLAIMED_RESULT'
  | 'INVALID_EQUATION';

export class ExpressionSyntaxError extends MathError {
  constructor(
    readonly code: SyntaxErrorCode,
    message: string,
    /** Posición (0-based) en el texto original, si aplica. */
    readonly position: number | null = null,
  ) {
    super(message);
  }
}

export type InvalidPowerCode =
  'NON_INTEGER_EXPONENT' | 'EXPONENT_TOO_LARGE' | 'RESULT_TOO_LARGE' | 'ZERO_TO_ZERO';

/**
 * Potencia que el motor no evalúa: exponente no entero, exponente o resultado desmesurados, o `0 ^ 0`.
 * Es un error del jugador (como dividir entre cero): `ChallengeEngine` lo informa como `SYNTAX_ERROR`.
 */
export class InvalidPowerError extends MathError {
  constructor(
    readonly code: InvalidPowerCode,
    message: string,
  ) {
    super(message);
  }
}

export type EquationErrorCode = 'NON_LINEAR' | 'NO_UNIQUE_SOLUTION';

/** El enunciado no es una ecuación lineal en `x` con solución única (defecto del catálogo, no del jugador). */
export class EquationError extends MathError {
  constructor(
    readonly code: EquationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
