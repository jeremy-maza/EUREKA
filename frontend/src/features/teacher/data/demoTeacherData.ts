export type DemoStudent = {
  id: string
  name: string
  correctAnswers: number
  incorrectAnswers: number
  topicErrors: Record<string, number>
  operationErrors: { label: string; count: number }[]
  accuracyHistory: number[]
}

export const difficultyTopics = [
  'Sumas',
  'Restas',
  'Multiplicaciones',
  'Divisiones',
  'Fracciones',
  'Números negativos',
  'Operaciones combinadas',
] as const

export const demoTeacherStudents: DemoStudent[] = [
  {
    id: 'alex',
    name: 'Alex Rivera',
    correctAnswers: 27,
    incorrectAnswers: 14,
    topicErrors: { Sumas: 0, Restas: 0, Multiplicaciones: 1, Divisiones: 8, Fracciones: 5, 'Números negativos': 0, 'Operaciones combinadas': 0 },
    operationErrors: [{ label: 'División exacta', count: 6 }, { label: 'División con resto', count: 2 }, { label: 'Fracciones equivalentes', count: 5 }, { label: 'Multiplicación', count: 1 }],
    accuracyHistory: [48, 52, 59, 62, 66],
  },
  {
    id: 'sofia',
    name: 'Sofía Torres',
    correctAnswers: 40,
    incorrectAnswers: 5,
    topicErrors: { Sumas: 0, Restas: 0, Multiplicaciones: 0, Divisiones: 2, Fracciones: 2, 'Números negativos': 0, 'Operaciones combinadas': 1 },
    operationErrors: [{ label: 'Fracciones equivalentes', count: 2 }, { label: 'División exacta', count: 2 }, { label: 'Operaciones combinadas', count: 1 }],
    accuracyHistory: [76, 80, 84, 87, 89],
  },
  {
    id: 'mateo',
    name: 'Mateo Castillo',
    correctAnswers: 24,
    incorrectAnswers: 16,
    topicErrors: { Sumas: 0, Restas: 0, Multiplicaciones: 0, Divisiones: 4, Fracciones: 6, 'Números negativos': 4, 'Operaciones combinadas': 2 },
    operationErrors: [{ label: 'Fracciones equivalentes', count: 6 }, { label: 'División con resto', count: 4 }, { label: 'Números negativos', count: 4 }, { label: 'Operaciones combinadas', count: 2 }],
    accuracyHistory: [54, 57, 55, 59, 60],
  },
  {
    id: 'lucia',
    name: 'Lucía Herrera',
    correctAnswers: 35,
    incorrectAnswers: 7,
    topicErrors: { Sumas: 0, Restas: 3, Multiplicaciones: 2, Divisiones: 1, Fracciones: 1, 'Números negativos': 0, 'Operaciones combinadas': 0 },
    operationErrors: [{ label: 'Restas con reagrupación', count: 3 }, { label: 'Multiplicación', count: 2 }, { label: 'División exacta', count: 1 }, { label: 'Fracciones equivalentes', count: 1 }],
    accuracyHistory: [72, 75, 78, 80, 83],
  },
  {
    id: 'diego',
    name: 'Diego Morales',
    correctAnswers: 18,
    incorrectAnswers: 18,
    topicErrors: { Sumas: 2, Restas: 0, Multiplicaciones: 0, Divisiones: 7, Fracciones: 3, 'Números negativos': 4, 'Operaciones combinadas': 2 },
    operationErrors: [{ label: 'División exacta', count: 5 }, { label: 'División con resto', count: 2 }, { label: 'Números negativos', count: 4 }, { label: 'Fracciones equivalentes', count: 3 }, { label: 'Operaciones combinadas', count: 2 }, { label: 'Sumas', count: 2 }],
    accuracyHistory: [58, 55, 52, 49, 50],
  },
  {
    id: 'valentina',
    name: 'Valentina Ríos',
    correctAnswers: 30,
    incorrectAnswers: 4,
    topicErrors: { Sumas: 1, Restas: 0, Multiplicaciones: 1, Divisiones: 1, Fracciones: 1, 'Números negativos': 0, 'Operaciones combinadas': 0 },
    operationErrors: [{ label: 'Sumas', count: 1 }, { label: 'Multiplicación', count: 1 }, { label: 'División exacta', count: 1 }, { label: 'Fracciones equivalentes', count: 1 }],
    accuracyHistory: [79, 82, 84, 86, 88],
  },
]

export const getStudentAccuracy = (student: DemoStudent) =>
  Math.round((student.correctAnswers / (student.correctAnswers + student.incorrectAnswers)) * 100)

export const getStudentStatus = (student: DemoStudent) => {
  const accuracy = getStudentAccuracy(student)
  if (accuracy < 60) return 'support' as const
  if (accuracy < 80) return 'watch' as const
  return 'good' as const
}

export const getStudentErrorCount = (student: DemoStudent) =>
  Object.values(student.topicErrors).reduce((total, count) => total + count, 0)
