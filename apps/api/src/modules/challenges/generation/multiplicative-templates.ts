import { BinaryOperator } from '../math';
import { SeededRandom } from './seeded-random';
import { ChallengeDifficultyProfile, TemplateId } from './generation.types';

export interface TemplateContext {
  rng: SeededRandom;
  profile: ChallengeDifficultyProfile;
  /** Dígitos prohibidos: se favorece que los operandos los contengan para que el enunciado "muerda". */
  biasDigits: readonly number[];
}

export interface StatementCandidate {
  templateId: TemplateId;
  /** Texto del enunciado. El resultado NO se calcula aquí: lo evalúa `MathEvaluator`. */
  expression: string;
}

type Tpl =
  { kind: 'literal'; value: number } | { kind: 'binary'; operator: BinaryOperator; left: Tpl; right: Tpl };

/** Intentos máximos de redibujar un operando buscando uno que contenga un dígito prohibido. */
const BIAS_DRAWS = 6;

const PRECEDENCE: Record<BinaryOperator, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/**
 * Familia multiplicativa inicial. Elige una plantilla según `profile.complexity` y el número de
 * literales, y la instancia con operandos del rango del perfil. Es una función pura del RNG: el mismo
 * estado produce el mismo enunciado.
 */
export function generateMultiplicativeStatement(context: TemplateContext): StatementCandidate {
  const { rng, profile } = context;
  const count = rng.nextInt(profile.operandCount.min, profile.operandCount.max);
  const templateId = rng.pick(availableTemplates(profile.complexity, count));

  let tree = BUILDERS[templateId](context, count);
  let usedTemplate = templateId;
  if (tree === null) {
    // p. ej. no existe divisor exacto en el rango: se degrada a un producto, siempre posible.
    tree = productChain(context, count);
    usedTemplate = 'PRODUCT_CHAIN';
  }
  return { templateId: usedTemplate, expression: render(tree) };
}

export function availableTemplates(
  complexity: ChallengeDifficultyProfile['complexity'],
  count: number,
): TemplateId[] {
  if (count < 3 || complexity === 'PRODUCT') return ['PRODUCT_CHAIN'];
  const templates: TemplateId[] = ['PRODUCT_CHAIN', 'PRODUCT_QUOTIENT', 'PRODUCT_SUM'];
  if (complexity === 'NESTED') templates.push('PARENTHESIZED_SUM_PRODUCT');
  return templates;
}

const BUILDERS: Record<TemplateId, (context: TemplateContext, count: number) => Tpl | null> = {
  PRODUCT_CHAIN: productChain,
  PRODUCT_QUOTIENT: productQuotient,
  PRODUCT_SUM: productSum,
  PARENTHESIZED_SUM_PRODUCT: parenthesizedSumProduct,
};

/** `a * b * c …` */
function productChain(context: TemplateContext, count: number): Tpl {
  return product(operands(context, count));
}

/** `a * b / c`: el divisor divide exactamente al producto (salvo `allowFractions`). */
function productQuotient(context: TemplateContext, count: number): Tpl | null {
  const { rng, profile } = context;
  const factors = operands(context, count - 1);
  const low = Math.max(2, profile.operandRange.min);
  const high = profile.operandRange.max;
  if (low > high) return null;

  let divisor: number | null = null;
  if (profile.allowFractions) {
    divisor = rng.nextInt(low, high);
  } else {
    const productValue = factors.reduce((acc, f) => acc * BigInt(literalValue(f)), 1n);
    const divisors: number[] = [];
    for (let d = low; d <= high; d++) if (productValue % BigInt(d) === 0n) divisors.push(d);
    if (divisors.length > 0) divisor = rng.pick(divisors);
  }
  if (divisor === null) return null;
  return binary('/', product(factors), literal(divisor));
}

/** `a * b + c`, `a * b - c * d`… (dos términos, al menos uno es un producto). */
function productSum(context: TemplateContext, count: number): Tpl {
  const { rng } = context;
  const firstSize = rng.nextInt(2, count - 1);
  const terms = [product(operands(context, firstSize)), product(operands(context, count - firstSize))];
  return signedPair(rng, rng.shuffle(terms));
}

/** `(a + b) * c`, `a * (b - c) * d`, `(a + b) * (c - d)`… */
function parenthesizedSumProduct(context: TemplateContext, count: number): Tpl {
  const { rng } = context;
  const groupCount = count >= 4 && rng.chance(0.5) ? 2 : 1;
  const factors: Tpl[] = [];
  for (let g = 0; g < groupCount; g++) factors.push(signedPair(rng, operands(context, 2)));
  factors.push(...operands(context, count - 2 * groupCount));
  return product(rng.shuffle(factors));
}

/** Une dos términos con `+` o `-`; con `-` pone delante el mayor (heurística para evitar negativos). */
function signedPair(rng: SeededRandom, [first, second]: Tpl[]): Tpl {
  const operator: BinaryOperator = rng.chance(0.5) ? '+' : '-';
  if (operator === '-' && magnitude(first) < magnitude(second)) return binary('-', second, first);
  return binary(operator, first, second);
}

/** Producto aproximado de los literales de un término; solo ordena la resta, no define resultados. */
function magnitude(node: Tpl): number {
  return node.kind === 'literal'
    ? node.value
    : node.operator === '+' || node.operator === '-'
      ? magnitude(node.left) + magnitude(node.right)
      : magnitude(node.left) * magnitude(node.right);
}

function operands(context: TemplateContext, count: number): Tpl[] {
  return Array.from({ length: count }, () => pickOperand(context));
}

function pickOperand({ rng, profile, biasDigits }: TemplateContext): Tpl {
  const { min, max } = profile.operandRange;
  let value = rng.nextInt(min, max);
  if (biasDigits.length > 0 && rng.chance(0.5)) {
    for (let draw = 0; draw < BIAS_DRAWS && !containsAnyDigit(value, biasDigits); draw++) {
      value = rng.nextInt(min, max);
    }
  }
  return literal(value);
}

function containsAnyDigit(value: number, digits: readonly number[]): boolean {
  const text = String(value);
  return digits.some((digit) => text.includes(String(digit)));
}

function literal(value: number): Tpl {
  return { kind: 'literal', value };
}

function literalValue(node: Tpl): number {
  if (node.kind !== 'literal') throw new Error('Se esperaba un literal.');
  return node.value;
}

function binary(operator: BinaryOperator, left: Tpl, right: Tpl): Tpl {
  return { kind: 'binary', operator, left, right };
}

/** Cadena `*` asociada a la izquierda, como la parsea el `ExpressionParser`. */
function product(factors: Tpl[]): Tpl {
  return factors.reduce((acc, factor) => binary('*', acc, factor));
}

/** Texto con los paréntesis mínimos que conservan la estructura del árbol. */
function render(node: Tpl, parent?: { operator: BinaryOperator; side: 'left' | 'right' }): string {
  if (node.kind === 'literal') return String(node.value);
  const text = `${render(node.left, { operator: node.operator, side: 'left' })} ${node.operator} ${render(node.right, { operator: node.operator, side: 'right' })}`;
  if (!parent) return text;
  const own = PRECEDENCE[node.operator];
  const outer = PRECEDENCE[parent.operator];
  return own < outer || (own === outer && parent.side === 'right') ? `(${text})` : text;
}
