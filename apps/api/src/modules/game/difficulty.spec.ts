import { adaptiveDifficultyPolicy, summarizePerformance } from './difficulty';

const policy = adaptiveDifficultyPolicy;
const C = 'CORRECT' as const;
const I = 'INCORRECT' as const;
const T = 'TIMEOUT' as const;

describe('summarizePerformance', () => {
  it('sin historial no hay rendimiento', () => {
    expect(summarizePerformance([])).toBeNull();
  });

  it('calcula precisión, tasa de timeouts y fallos consecutivos recientes (más reciente primero)', () => {
    expect(summarizePerformance([I, T, C, C])).toEqual({
      attempts: 4,
      accuracy: 0.5,
      timeoutRate: 0.25,
      consecutiveFailures: 2,
    });
    expect(summarizePerformance([T, I])?.consecutiveFailures).toBe(2);
  });

  it('solo mira la ventana de intentos recientes (12)', () => {
    const outcomes = [...Array(12).fill(C), ...Array(30).fill(I)];
    expect(summarizePerformance(outcomes)).toMatchObject({ attempts: 12, accuracy: 1 });
  });
});

describe('adaptiveDifficultyPolicy', () => {
  const select = (outcomes: ('CORRECT' | 'INCORRECT' | 'TIMEOUT')[], streak = 0, completions = 0) =>
    policy.selectDifficulty({
      currentStreak: streak,
      completionsCount: completions,
      performance: summarizePerformance(outcomes),
    });

  it('un jugador nuevo empieza en dificultad normal', () => {
    expect(select([])).toBe('BASELINE');
  });

  it('baja la dificultad tras 3 fallos seguidos o con mucha dificultad sostenida', () => {
    expect(select([I, I, T, C, C, C])).toBe('EASIER');
    expect(select([C, I, I, C, I, I, I, I].reverse().slice(0, 8))).toBe('EASIER');
    expect(select([C, T, T, C, T, T])).toBe('EASIER'); // mitad de timeouts
  });

  it('la sube si ya completó el mundo y mantiene racha, o si acierta casi siempre', () => {
    expect(select([C, C, C], 3, 1)).toBe('HARDER');
    expect(select([C, C, C, C, C])).toBe('HARDER');
  });

  it('con poca evidencia o rendimiento intermedio se queda en normal', () => {
    expect(select([C, C])).toBe('BASELINE'); // 100 % pero solo 2 intentos
    expect(select([C, I, C, I, C, C])).toBe('BASELINE');
    expect(select([C, C, C], 3, 0)).toBe('BASELINE'); // racha sin haber completado y poca evidencia
  });

  it('un fallo reciente impide subir aunque la precisión sea alta', () => {
    expect(select([I, C, C, C, C, C, C, C, C, C])).toBe('BASELINE');
  });
});
