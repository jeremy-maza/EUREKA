export interface WorldSummary {
  slug: string;
  name: string;
  description: string;
  /** Solo el Mundo 1 está disponible en el MVP. */
  available: boolean;
}

export const WORLDS: readonly WorldSummary[] = [
  {
    slug: 'arithmetic',
    name: 'Aritmética',
    description: 'Suma, resta, multiplicación y división bajo reglas acumulativas.',
    available: true,
  },
  {
    slug: 'numbers-and-signs',
    name: 'Números y signos',
    description: 'Positivos, negativos y el comportamiento de los signos.',
    available: false,
  },
  {
    slug: 'fractions-and-decimals',
    name: 'Fracciones y decimales',
    description: 'Partes de un entero y sus representaciones.',
    available: false,
  },
  { slug: 'algebra', name: 'Álgebra', description: 'Incógnitas, ecuaciones y estructura.', available: false },
  {
    slug: 'chaos',
    name: 'Caos matemático',
    description: 'Todas las ideas anteriores, sin red.',
    available: false,
  },
];
