import { BinaryOperator } from './ast';
import { ExpressionSyntaxError } from './math.errors';
import { DEFAULT_MATH_SYNTAX, MathSyntax } from './syntax';

export type Token =
  | {
      type: 'number';
      /** Texto original del literal (con su separador decimal, si lo tiene). */
      text: string;
      /** Solo las cifras, sin separador: `"2,50"` → `"250"`. */
      digits: string;
      /** Cifras tras el separador decimal (0 en los enteros). */
      decimals: number;
      position: number;
    }
  | { type: 'operator'; value: BinaryOperator; position: number }
  | { type: 'variable'; name: 'x'; position: number }
  | { type: 'lparen' | 'rparen' | 'equals' | 'end'; position: number };

/**
 * Qué hacer con la letra `x`:
 *  - `allow`: es la incógnita (enunciados de ecuaciones).
 *  - `hint`: error `VARIABLE_NOT_ALLOWED` con un mensaje que lo explica (respuestas a una ecuación).
 *  - `none`: un carácter no permitido más (comportamiento original del Mundo 1).
 */
export type VariableMode = 'allow' | 'hint' | 'none';

export interface TokenizeOptions {
  syntax?: MathSyntax;
  variable?: VariableMode;
}

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

const DECIMALS_NOT_SUPPORTED_MESSAGE = 'Los números decimales todavía no están permitidos en este mundo.';

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isDecimalSeparator(char: string | undefined): boolean {
  return char === '.' || char === ',';
}

/**
 * Convierte el texto en tokens. Solo reconoce un alfabeto cerrado (dígitos, + - * / ( ) = y espacios,
 * más `^`, separador decimal y la incógnita `x` cuando la sintaxis/el modo lo permiten): nada de
 * identificadores ni funciones.
 */
export function tokenize(source: string, options: TokenizeOptions = {}): Token[] {
  const syntax = options.syntax ?? DEFAULT_MATH_SYNTAX;
  const variable = options.variable ?? 'none';
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
    } else if (isDigit(char)) {
      const start = index;
      while (isDigit(source[index])) index += 1;
      let decimals = 0;
      if (isDecimalSeparator(source[index])) {
        if (!syntax.decimals) {
          throw new ExpressionSyntaxError('DECIMALS_NOT_SUPPORTED', DECIMALS_NOT_SUPPORTED_MESSAGE, index);
        }
        const separator = index;
        index += 1;
        const fractionStart = index;
        while (isDigit(source[index])) index += 1;
        decimals = index - fractionStart;
        if (decimals === 0) {
          throw new ExpressionSyntaxError(
            'INVALID_NUMBER',
            `Al número de la posición ${start + 1} le faltan las cifras decimales después de "${source[separator]}".`,
            separator,
          );
        }
        if (isDecimalSeparator(source[index])) {
          throw new ExpressionSyntaxError(
            'INVALID_NUMBER',
            `Un número solo puede tener un separador decimal (posición ${index + 1}).`,
            index,
          );
        }
      }
      const text = source.slice(start, index);
      tokens.push({ type: 'number', text, digits: text.replace(/[.,]/, ''), decimals, position: start });
    } else if (char in NORMALIZED_OPERATORS) {
      tokens.push({ type: 'operator', value: NORMALIZED_OPERATORS[char], position: index });
      index += 1;
    } else if (char === '^' && syntax.powers) {
      tokens.push({ type: 'operator', value: '^', position: index });
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
    } else if (isDecimalSeparator(char)) {
      if (!syntax.decimals) {
        throw new ExpressionSyntaxError('DECIMALS_NOT_SUPPORTED', DECIMALS_NOT_SUPPORTED_MESSAGE, index);
      }
      throw new ExpressionSyntaxError(
        'INVALID_NUMBER',
        `Escribe una cifra antes del separador decimal (posición ${index + 1}): por ejemplo 0.5 en lugar de .5.`,
        index,
      );
    } else if ((char === 'x' || char === 'X') && variable !== 'none') {
      if (variable === 'hint') {
        throw new ExpressionSyntaxError(
          'VARIABLE_NOT_ALLOWED',
          `Tu respuesta no puede contener la incógnita "x" (posición ${index + 1}): escribe una expresión ` +
            'solo con números cuyo valor sea la solución de la ecuación. Para multiplicar usa *.',
          index,
        );
      }
      tokens.push({ type: 'variable', name: 'x', position: index });
      index += 1;
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
