import { BinaryNode, BinaryOperator, ExpressionNode } from './ast';
import { ExpressionSyntaxError } from './math.errors';
import { Token, tokenize } from './tokenizer';

/**
 * Respuesta del jugador: una expresión y, opcionalmente, `= resultado`.
 * El resultado declarado es solo un literal entero (no una expresión), por lo que
 * NO está sujeto a las reglas: `41 + 1 = 42` es válido aunque el dígito 2 esté prohibido.
 */
export interface ParsedAnswer {
  expression: ExpressionNode;
  claimedResult: bigint | null;
}

export interface ExpressionParserOptions {
  /** Longitud máxima del texto; también acota la profundidad de recursión. */
  maxLength?: number;
}

export const DEFAULT_MAX_EXPRESSION_LENGTH = 200;

/**
 * Parser de descenso recursivo. Gramática:
 *
 *   answer     := expression ( '=' ['-'] NUMBER )? EOF
 *   expression := term ( ('+' | '-') term )*
 *   term       := unary ( ('*' | '/') unary )*
 *   unary      := '-' unary | primary
 *   primary    := NUMBER | '(' expression ')'
 *
 * Nunca ejecuta código del jugador: solo construye un AST de datos.
 */
export class ExpressionParser {
  private readonly maxLength: number;

  constructor(options: ExpressionParserOptions = {}) {
    this.maxLength = options.maxLength ?? DEFAULT_MAX_EXPRESSION_LENGTH;
  }

  /** Parsea una expresión sin signo `=` (p. ej. el enunciado de un reto). */
  parseExpression(source: string): ExpressionNode {
    const state = this.createState(source);
    const expression = state.parseExpression();
    state.expectEnd();
    return expression;
  }

  /** Parsea una respuesta: `expresión` o `expresión = resultado`. */
  parseAnswer(source: string): ParsedAnswer {
    const state = this.createState(source);
    const expression = state.parseExpression();
    const claimedResult = state.parseClaimedResult();
    state.expectEnd();
    return { expression, claimedResult };
  }

  private createState(source: string): ParserState {
    if (source.trim().length === 0) {
      throw new ExpressionSyntaxError('EMPTY_EXPRESSION', 'Escribe una expresión.');
    }
    if (source.length > this.maxLength) {
      throw new ExpressionSyntaxError(
        'EXPRESSION_TOO_LONG',
        `La expresión supera el máximo de ${this.maxLength} caracteres.`,
      );
    }
    return new ParserState(tokenize(source));
  }
}

class ParserState {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): ExpressionNode {
    let left = this.parseTerm();
    for (let token = this.peek(); this.isOperator(token, '+', '-'); token = this.peek()) {
      this.index += 1;
      const right = this.parseTerm();
      left = this.binary(token.value, left, right);
    }
    return left;
  }

  parseClaimedResult(): bigint | null {
    if (this.peek().type !== 'equals') return null;
    this.index += 1;

    let negative = false;
    const first = this.peek();
    if (this.isOperator(first, '-')) {
      negative = true;
      this.index += 1;
    }
    const numberToken = this.peek();
    if (numberToken.type !== 'number') {
      throw new ExpressionSyntaxError(
        'INVALID_CLAIMED_RESULT',
        'Después del signo = debe ir solo el resultado (un número entero).',
        numberToken.position,
      );
    }
    this.index += 1;
    const value = BigInt(numberToken.text);
    return negative ? -value : value;
  }

  expectEnd(): void {
    const token = this.peek();
    switch (token.type) {
      case 'end':
        return;
      case 'rparen':
        throw new ExpressionSyntaxError(
          'UNBALANCED_PARENTHESES',
          `Paréntesis ")" sin abrir en la posición ${token.position + 1}.`,
          token.position,
        );
      case 'equals':
        throw new ExpressionSyntaxError(
          'UNEXPECTED_TOKEN',
          `Solo se permite un signo = y debe ir al final (posición ${token.position + 1}).`,
          token.position,
        );
      default:
        throw this.missingOperator(token);
    }
  }

  private parseTerm(): ExpressionNode {
    let left = this.parseUnary();
    for (let token = this.peek(); this.isOperator(token, '*', '/'); token = this.peek()) {
      this.index += 1;
      const right = this.parseUnary();
      left = this.binary(token.value, left, right);
    }
    return left;
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek();
    if (this.isOperator(token, '-')) {
      this.index += 1;
      return { kind: 'negation', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();

    if (token.type === 'number') {
      this.index += 1;
      return { kind: 'number', value: BigInt(token.text), text: token.text };
    }

    if (token.type === 'lparen') {
      this.index += 1;
      const inner = this.parseExpression();
      const closing = this.peek();
      if (closing.type !== 'rparen') {
        if (closing.type === 'end') {
          throw new ExpressionSyntaxError(
            'UNBALANCED_PARENTHESES',
            `Falta cerrar el paréntesis abierto en la posición ${token.position + 1}.`,
            token.position,
          );
        }
        throw this.missingOperator(closing);
      }
      this.index += 1;
      return inner;
    }

    if (token.type === 'end') {
      throw new ExpressionSyntaxError(
        'UNEXPECTED_END',
        'La expresión está incompleta: falta un número al final.',
        token.position,
      );
    }

    throw new ExpressionSyntaxError(
      'UNEXPECTED_TOKEN',
      `Se esperaba un número o "(" en la posición ${token.position + 1}, pero se encontró ${this.describe(token)}.`,
      token.position,
    );
  }

  private binary(operator: BinaryOperator, left: ExpressionNode, right: ExpressionNode): BinaryNode {
    return { kind: 'binary', operator, left, right };
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private isOperator(
    token: Token,
    ...operators: BinaryOperator[]
  ): token is Extract<Token, { type: 'operator' }> {
    return token.type === 'operator' && operators.includes(token.value);
  }

  private missingOperator(token: Token): ExpressionSyntaxError {
    return new ExpressionSyntaxError(
      'UNEXPECTED_TOKEN',
      `Falta un operador antes de ${this.describe(token)} (posición ${token.position + 1}). No existe la multiplicación implícita.`,
      token.position,
    );
  }

  private describe(token: Token): string {
    switch (token.type) {
      case 'number':
        return `el número ${token.text}`;
      case 'operator':
        return `el operador "${token.value}"`;
      case 'lparen':
        return '"("';
      case 'rparen':
        return '")"';
      case 'equals':
        return '"="';
      case 'end':
        return 'el final de la expresión';
    }
  }
}
