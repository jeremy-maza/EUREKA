import { BinaryOperator } from './ast';
import { ExpressionSyntaxError } from './math.errors';

export type Token =
  | { type: 'number'; text: string; position: number }
  | { type: 'operator'; value: BinaryOperator; position: number }
  | { type: 'lparen' | 'rparen' | 'equals' | 'end'; position: number };

/** Símbolos tipográficos que los estudiantes pueden pegar/escribir. */
const NORMALIZED_OPERATORS: Readonly<Record<string, BinaryOperator>> = {
  '+': '+',
  '-': '-',
  '−': '-', // U+2212 signo menos
  '–': '-', // U+2013 guion corto
  '*': '*',
  '×': '*',
  '/': '/',
  '÷': '/',
};

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

/**
 * Convierte el texto en tokens. Solo reconoce un alfabeto cerrado
 * (dígitos, + - * / ( ) = y espacios): nada de identificadores ni funciones.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
    } else if (isDigit(char)) {
      const start = index;
      while (index < source.length && isDigit(source[index])) index += 1;
      if (source[index] === '.' || source[index] === ',') {
        throw new ExpressionSyntaxError(
          'DECIMALS_NOT_SUPPORTED',
          'Los números decimales todavía no están permitidos en este mundo.',
          index,
        );
      }
      tokens.push({ type: 'number', text: source.slice(start, index), position: start });
    } else if (char in NORMALIZED_OPERATORS) {
      tokens.push({ type: 'operator', value: NORMALIZED_OPERATORS[char], position: index });
      index += 1;
    } else if (char === '(') {
      tokens.push({ type: 'lparen', position: index });
      index += 1;
    } else if (char === ')') {
      tokens.push({ type: 'rparen', position: index });
      index += 1;
    } else if (char === '=') {
      tokens.push({ type: 'equals', position: index });
      index += 1;
    } else if (char === '.' || char === ',') {
      throw new ExpressionSyntaxError(
        'DECIMALS_NOT_SUPPORTED',
        'Los números decimales todavía no están permitidos en este mundo.',
        index,
      );
    } else {
      throw new ExpressionSyntaxError(
        'UNEXPECTED_CHARACTER',
        `Carácter no permitido "${char}" en la posición ${index + 1}.`,
        index,
      );
    }
  }

  tokens.push({ type: 'end', position: source.length });
  return tokens;
}
