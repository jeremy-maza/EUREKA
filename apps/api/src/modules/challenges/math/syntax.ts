/**
 * Sintaxis que admite un mundo. Cada mundo la declara en su catálogo y el parser la recibe en cada llamada
 * (no hay un parser global por mundo). Por defecto (Mundo 1) solo enteros y `+ - * / ( ) =`.
 */
export interface MathSyntax {
  /** Literales decimales exactos (`2.5` ≡ 5/2). */
  decimals: boolean;
  /** Potencias con exponente entero (`2 ^ 3`). */
  powers: boolean;
}

export const DEFAULT_MATH_SYNTAX: MathSyntax = { decimals: false, powers: false };
