export type RankedStudent = {
  id: string
  name: string
  points: number
  isCurrentStudent?: boolean
}

export const demoClassifications: RankedStudent[] = [
  { id: 'maria', name: 'María López', points: 2480 },
  { id: 'alex', name: 'Alex Rivera', points: 2310, isCurrentStudent: true },
  { id: 'santiago', name: 'Santiago Cruz', points: 2190 },
  { id: 'valentina', name: 'Valentina Ríos', points: 2040 },
  { id: 'diego', name: 'Diego Morales', points: 1920 },
  { id: 'sofia', name: 'Sofía Torres', points: 1810 },
  { id: 'mateo', name: 'Mateo Castillo', points: 1690 },
  { id: 'lucia', name: 'Lucía Herrera', points: 1530 },
]
