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
  | 'UNEXPECTED_TOKEN'
  | 'UNEXPECTED_END'
  | 'UNBALANCED_PARENTHESES'
  | 'INVALID_CLAIMED_RESULT';

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
