export type ChallengeRule = {
  id: string
  text: string
}

export type Challenge = {
  number: number
  operation: string
  instruction: string
  hint: string
  rules: ChallengeRule[]
}

export const arithmeticChallenges: Challenge[] = [
  {
    number: 1,
    operation: '8 + 7',
    instruction: 'Encuentra un resultado mayor que 10',
    hint: 'Cada respuesta abre una nueva pista.',
    rules: [{ id: 'greater-than-10', text: 'El resultado debe ser mayor que 10' }],
  },
  {
    number: 2,
    operation: '9 × 3',
    instruction: 'Cumple todas las reglas acumuladas',
    hint: 'Primero revisa la regla anterior.',
    rules: [
      { id: 'greater-than-10', text: 'El resultado debe ser mayor que 10' },
      { id: 'even', text: 'La respuesta debe ser un número par' },
    ],
  },
  {
    number: 3,
    operation: '24 ÷ 2',
    instruction: 'Descubre la respuesta correcta',
    hint: 'Una condición nueva acaba de aparecer.',
    rules: [
      { id: 'greater-than-10', text: 'El resultado debe ser mayor que 10' },
      { id: 'even', text: 'La respuesta debe ser un número par' },
      { id: 'no-five', text: 'No puedes utilizar el número 5' },
    ],
  },
  {
    number: 4,
    operation: '6 × 6',
    instruction: 'Resuelve el último descubrimiento',
    hint: 'Todas las reglas siguen activas.',
    rules: [
      { id: 'greater-than-10', text: 'El resultado debe ser mayor que 10' },
      { id: 'even', text: 'La respuesta debe ser un número par' },
      { id: 'no-five', text: 'No puedes utilizar el número 5' },
      { id: 'multiple-three', text: 'La respuesta debe ser múltiplo de 3' },
    ],
  },
]
