import { createHash } from 'node:crypto';
import { ExpressionNode, Fraction, isCommutative } from '../math';

/** Se incrementa si cambia el algoritmo de normalización (invalida huellas anteriores a propósito). */
export const FINGERPRINT_VERSION = 'fp1';

/**
 * Forma canónica del AST para detectar enunciados equivalentes por formato:
 *   - los literales se comparan por valor (`07` ≡ `7`);
 *   - `+` y `*` son conmutativos y asociativos: se aplanan y se ordenan sus operandos
 *     (`3*7`, `7 * 3` y `(3*7)*2` ≡ `2*(7*3)`);
 *   - `-` y `/` conservan el orden y la estructura.
 * No hay reescritura algebraica (no se evalúan subárboles): `2*3` y `6` siguen siendo distintos.
 */
export function canonicalizeExpression(node: ExpressionNode): string {
  switch (node.kind) {
    case 'number':
      return node.value.toString();
    case 'negation':
      return `neg(${canonicalizeExpression(node.operand)})`;
    case 'binary': {
      if (isCommutative(node.operator)) {
        const operands = flatten(node, node.operator).map(canonicalizeExpression).sort();
        return `${node.operator}[${operands.join(',')}]`;
      }
      return `${node.operator}(${canonicalizeExpression(node.left)},${canonicalizeExpression(node.right)})`;
    }
  }
}

function flatten(node: ExpressionNode, operator: string): ExpressionNode[] {
  if (node.kind === 'binary' && node.operator === operator) {
    return [...flatten(node.left, operator), ...flatten(node.right, operator)];
  }
  return [node];
}

/**
 * Huella estable de un reto: hash de (enunciado normalizado, resultado esperado). Es independiente
 * del formato del texto, de la solución de referencia y de la versión del generador.
 */
export function fingerprintChallenge(expression: ExpressionNode, expectedResult: Fraction): string {
  const material = `${FINGERPRINT_VERSION}|${canonicalizeExpression(expression)}|=${expectedResult.toString()}`;
  return `${FINGERPRINT_VERSION}-${createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}
