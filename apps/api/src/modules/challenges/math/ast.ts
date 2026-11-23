import { Fraction } from './fraction';

/** `^` (potencia) solo existe en los mundos cuya sintaxis lo admite (`MathSyntax.powers`). */
export type BinaryOperator = '+' | '-' | '*' | '/' | '^';

export const BINARY_OPERATORS: readonly BinaryOperator[] = ['+', '-', '*', '/', '^'];

/**
 * Marca que pone el parser en el nodo que estaba escrito entre paréntesis: `(2 + 3) * 4` marca el `+`.
 * No cambia el valor ni la huella del enunciado; lo usa la regla REQUIRED_PARENTHESES.
 */
interface Groupable {
  grouped?: true;
}

/**
 * Literal numérico. `text` conserva los dígitos tal como los escribió el jugador (p. ej. "007" o "2,50").
 * El valor exacto es `value / 10^decimals` (`numberValue`): `2.5` → value 25n, decimals 1.
 * En los literales enteros `decimals` no existe y `value` es directamente su valor.
 */
export interface NumberNode extends Groupable {
  kind: 'number';
  value: bigint;
  text: string;
  /** Cifras decimales escritas (solo en literales decimales, p. ej. 2 en "2.50"). */
  decimals?: number;
}

/** Menos unario: `-3`, `-(2 + 1)`. No es el operador binario `-`. */
export interface NegationNode extends Groupable {
  kind: 'negation';
  operand: ExpressionNode;
}

/** Los paréntesis no tienen nodo propio: solo afectan a la estructura y marcan `grouped`. */
export interface BinaryNode extends Groupable {
  kind: 'binary';
  operator: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
}

/** Incógnita `x`. Solo aparece en enunciados de tipo ecuación, nunca en respuestas. */
export interface VariableNode extends Groupable {
  kind: 'variable';
  name: 'x';
}

export type ExpressionNode = NumberNode | NegationNode | BinaryNode | VariableNode;

export function isCommutative(operator: BinaryOperator): boolean {
  return operator === '+' || operator === '*';
}

/** Valor exacto de un literal (también de los decimales). */
export function numberValue(node: NumberNode): Fraction {
  const decimals = node.decimals ?? 0;
  return decimals === 0 ? Fraction.of(node.value) : Fraction.of(node.value, 10n ** BigInt(decimals));
}

/** `true` si el literal se escribió con separador decimal (`2.5`, `3,0`). */
export function isDecimalLiteral(node: NumberNode): boolean {
  return (node.decimals ?? 0) > 0;
}

/** Devuelve todos los nodos del árbol (recorrido en preorden). */
export function collectNodes(root: ExpressionNode): ExpressionNode[] {
  const nodes: ExpressionNode[] = [];
  const stack: ExpressionNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as ExpressionNode;
    nodes.push(node);
    if (node.kind === 'binary') {
      stack.push(node.right, node.left);
    } else if (node.kind === 'negation') {
      stack.push(node.operand);
    }
  }
  return nodes;
}

export function collectNumbers(root: ExpressionNode): NumberNode[] {
  return collectNodes(root).filter((node): node is NumberNode => node.kind === 'number');
}

export function containsVariable(root: ExpressionNode): boolean {
  return collectNodes(root).some((node) => node.kind === 'variable');
}

/**
 * Precedencia de cada nodo según la gramática del parser (mayor = se agrupa antes):
 * `+ -` 1 · `* /` 2 · menos unario 3 · `^` 4 · literal/incógnita 5.
 */
export function nodePrecedence(node: ExpressionNode): number {
  switch (node.kind) {
    case 'number':
    case 'variable':
      return 5;
    case 'negation':
      return 3;
    case 'binary':
      return operatorPrecedence(node.operator);
  }
}

export function operatorPrecedence(operator: BinaryOperator): number {
  switch (operator) {
    case '+':
    case '-':
      return 1;
    case '*':
    case '/':
      return 2;
    case '^':
      return 4;
  }
}

/**
 * Precedencia mínima que debe tener un operando para escribirse SIN paréntesis en esa posición
 * (se deduce de la gramática: `a - (b + c)`, `a * (b * c)`, `(-2) ^ 2` y `(2 ^ 3) ^ 2` los necesitan;
 * `a + (b * c)`, `2 * (-3)` y `2 ^ (-1)` no).
 */
export function minimumOperandPrecedence(
  parent: BinaryOperator | 'negation',
  side: 'left' | 'right' = 'left',
): number {
  if (parent === 'negation') return 3;
  switch (parent) {
    case '+':
    case '-':
      return side === 'left' ? 1 : 2;
    case '*':
    case '/':
      return side === 'left' ? 2 : 3;
    case '^':
      // La base es un `primary` (literal o paréntesis); el exponente admite un menos unario.
      return side === 'left' ? 5 : 3;
  }
}

/**
 * Nodos escritos entre paréntesis NECESARIOS: quitarlos cambiaría la estructura de la expresión
 * (y, en general, el orden de las operaciones). `(2 + 3) * 4` → [`2 + 3`]; `(7) * 3`, `(2 * 3) + 4`
 * y `2 * (-3)` no tienen ninguno.
 */
export function necessaryGroups(root: ExpressionNode): ExpressionNode[] {
  const found: ExpressionNode[] = [];
  const visit = (node: ExpressionNode, minimum: number): void => {
    if (node.grouped && nodePrecedence(node) < minimum) found.push(node);
    if (node.kind === 'binary') {
      visit(node.left, minimumOperandPrecedence(node.operator, 'left'));
      visit(node.right, minimumOperandPrecedence(node.operator, 'right'));
    } else if (node.kind === 'negation') {
      visit(node.operand, minimumOperandPrecedence('negation'));
    }
  };
  visit(root, 0);
  return found;
}
