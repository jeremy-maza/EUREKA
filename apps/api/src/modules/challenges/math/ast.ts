export type BinaryOperator = '+' | '-' | '*' | '/';

export const BINARY_OPERATORS: readonly BinaryOperator[] = ['+', '-', '*', '/'];

/** Literal numérico. `text` conserva los dígitos tal como los escribió el jugador (p. ej. "007"). */
export interface NumberNode {
  kind: 'number';
  value: bigint;
  text: string;
}

/** Menos unario: `-3`, `-(2 + 1)`. */
export interface NegationNode {
  kind: 'negation';
  operand: ExpressionNode;
}

/** Los paréntesis solo afectan a la estructura del árbol; no tienen nodo propio. */
export interface BinaryNode {
  kind: 'binary';
  operator: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
}

export type ExpressionNode = NumberNode | NegationNode | BinaryNode;

export function isCommutative(operator: BinaryOperator): boolean {
  return operator === '+' || operator === '*';
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
