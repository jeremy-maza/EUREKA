import { BinaryNode, BinaryOperator, ExpressionNode, NumberNode } from './ast';
import { Fraction } from './fraction';
import { ExpressionSyntaxError } from './math.errors';
import { DEFAULT_MATH_SYNTAX, MathSyntax } from './syntax';
import { Token, VariableMode, tokenize } from './tokenizer';

/**
 * Respuesta del jugador: una expresión y, opcionalmente, `= resultado`.
 * El resultado declarado es solo un literal (no una expresión), por lo que NO está sujeto a las reglas:
 * `41 + 1 = 42` es válido aunque el dígito 2 esté prohibido.
 */
export interface ParsedAnswer {
  expression: ExpressionNode;
  /** Resultado declarado si es un entero (compatibilidad con el Mundo 1); `null` si no hay o es decimal. */
  claimedResult: bigint | null;
  /** Valor exacto del resultado declarado (entero o decimal), si lo hay. */
  claimedValue: Fraction | null;
  /** Texto del resultado declarado tal como se escribió (p. ej. "-2" o "3,5"), si lo hay. */
  claimedText: string | null;
}

/** Enunciado de tipo ecuación: `lado izquierdo = lado derecho`, con la incógnita `x`. */
export interface ParsedEquation {
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface ParseAnswerOptions {
  /**
   * El reto es una ecuación: si la respuesta contiene la incógnita `x`, el error lo explica
   * (`VARIABLE_NOT_ALLOWED`) en lugar del genérico "carácter no permitido".
   */
  equation?: boolean;
}

export interface ExpressionParserOptions {
  /** Longitud máxima del texto; también acota la profundidad de recursión. */
  maxLength?: number;
}

export const DEFAULT_MAX_EXPRESSION_LENGTH = 200;

/**
 * Parser de descenso recursivo. Gramática (`^` solo si `syntax.powers`; `x` solo en ecuaciones):
 *
 *   answer     := expression ( '=' ['-'] NUMBER )? EOF
 *   equation   := expression '=' expression EOF
 *   expression := term ( ('+' | '-') term )*
 *   term       := unary ( ('*' | '/') unary )*
 *   unary      := '-' unary | power
 *   power      := primary ( '^' unary )?          (asociativa por la derecha; `-2 ^ 2` = -(2 ^ 2))
 *   primary    := NUMBER | 'x' | '(' expression ')'
 *
 * La sintaxis del mundo se recibe en cada llamada (por defecto la del Mundo 1). Nunca ejecuta código
 * del jugador: solo construye un AST de datos.
 */
export class ExpressionParser {
  private readonly maxLength: number;

  constructor(options: ExpressionParserOptions = {}) {
    this.maxLength = options.maxLength ?? DEFAULT_MAX_EXPRESSION_LENGTH;
  }

  /** Parsea una expresión sin signo `=` (p. ej. el enunciado de un reto). */
  parseExpression(source: string, syntax: MathSyntax = DEFAULT_MATH_SYNTAX): ExpressionNode {
    const state = this.createState(source, syntax, 'none');
    const expression = state.parseExpression();
    state.expectEnd();
    return expression;
  }

  /** Parsea una respuesta: `expresión` o `expresión = resultado`. */
  parseAnswer(
    source: string,
    syntax: MathSyntax = DEFAULT_MATH_SYNTAX,
    options: ParseAnswerOptions = {},
  ): ParsedAnswer {
    const state = this.createState(source, syntax, options.equation ? 'hint' : 'none');
    const expression = state.parseExpression();
    const claimed = state.parseClaimedResult();
    state.expectEnd();
    return { expression, ...claimed };
  }

  /** Parsea el enunciado de una ecuación (`3 * x + 4 = 19`). No comprueba que sea lineal (ver `solveLinearEquation`). */
  parseEquation(source: string, syntax: MathSyntax = DEFAULT_MATH_SYNTAX): ParsedEquation {
    const state = this.createState(source, syntax, 'allow');
    const left = state.parseExpression();
    state.expectEquals();
    const right = state.parseExpression();
    state.expectEnd();
    return { left, right };
  }

  private createState(source: string, syntax: MathSyntax, variable: VariableMode): ParserState {
    if (source.trim().length === 0) {
      throw new ExpressionSyntaxError('EMPTY_EXPRESSION', 'Escribe una expresión.');
    }
    if (source.length > this.maxLength) {
      throw new ExpressionSyntaxError(
        'EXPRESSION_TOO_LONG',
        `La expresión supera el máximo de ${this.maxLength} caracteres.`,
      );
    }
    return new ParserState(tokenize(source, { syntax, variable }), syntax);
  }
}

type ClaimedResult = Pick<ParsedAnswer, 'claimedResult' | 'claimedValue' | 'claimedText'>;

const NO_CLAIM: ClaimedResult = { claimedResult: null, claimedValue: null, claimedText: null };

class ParserState {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly syntax: MathSyntax,
  ) {}

  parseExpression(): ExpressionNode {
    let left = this.parseTerm();
    for (let token = this.peek(); this.isOperator(token, '+', '-'); token = this.peek()) {
      this.index += 1;
      const right = this.parseTerm();
      left = this.binary(token.value, left, right);
    }
    return left;
  }

  parseClaimedResult(): ClaimedResult {
    if (this.peek().type !== 'equals') return NO_CLAIM;
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
        this.syntax.decimals
          ? 'Después del signo = debe ir solo el resultado (un número entero o decimal).'
          : 'Después del signo = debe ir solo el resultado (un número entero).',
        numberToken.position,
      );
    }
    this.index += 1;
    const literal = numberLiteral(numberToken);
    const value = negative ? literal.value.negate() : literal.value;
    const text = `${negative ? '-' : ''}${numberToken.text}`;
    if (numberToken.decimals > 0) return { claimedResult: null, claimedValue: value, claimedText: text };
    const integer = BigInt(numberToken.digits);
    return { claimedResult: negative ? -integer : integer, claimedValue: value, claimedText: text };
  }

  expectEquals(): void {
    const token = this.peek();
    if (token.type === 'equals') {
      this.index += 1;
      return;
    }
    if (token.type === 'end') {
      throw new ExpressionSyntaxError(
        'INVALID_EQUATION',
        'Una ecuación debe tener un signo =.',
        token.position,
      );
    }
    this.expectEnd();
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
    return this.parsePower();
  }

  private parsePower(): ExpressionNode {
    const base = this.parsePrimary();
    const token = this.peek();
    if (!this.isOperator(token, '^')) return base;
    this.index += 1;
    // Asociativa por la derecha: el exponente es un `unary` (que a su vez puede ser otra potencia).
    return this.binary('^', base, this.parseUnary());
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();
    if (token.type === 'number') {
      this.index += 1;
      return numberLiteral(token).node;
    }
    if (token.type === 'variable') {
      this.index += 1;
      return { kind: 'variable', name: 'x' };
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
      return { ...inner, grouped: true };
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
      case 'variable':
        return 'la incógnita x';
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

function numberLiteral(token: Extract<Token, { type: 'number' }>): { node: NumberNode; value: Fraction } {
  const value = BigInt(token.digits);
  if (token.decimals === 0) {
    return { node: { kind: 'number', value, text: token.text }, value: Fraction.of(value) };
  }
  return {
    node: { kind: 'number', value, text: token.text, decimals: token.decimals },
    value: Fraction.of(value, 10n ** BigInt(token.decimals)),
  };
}
