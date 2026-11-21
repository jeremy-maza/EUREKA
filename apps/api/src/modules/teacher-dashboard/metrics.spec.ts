import {
  accuracyPercent,
  addMetrics,
  attentionReasons,
  averageCorrectMs,
  emptyMetrics,
  percent,
} from './metrics';

describe('métricas del panel docente', () => {
  describe('disponible vs. cero', () => {
    it('sin intentos: la precisión NO está disponible (null), no vale 0', () => {
      expect(accuracyPercent(0, 0)).toBeNull();
      expect(percent(0, 0)).toBeNull();
    });

    it('con intentos y cero aciertos: la precisión es un 0 real', () => {
      expect(accuracyPercent(0, 4)).toBe(0);
    });

    it('sin aciertos el tiempo medio no está disponible (null)', () => {
      expect(averageCorrectMs(0, 0)).toBeNull();
      expect(averageCorrectMs(30_000, 3)).toBe(10_000);
    });

    it('los contadores vacíos son ceros reales', () => {
      expect(emptyMetrics()).toEqual({
        points: 0,
        attempts: 0,
        correct: 0,
        incorrect: 0,
        timeouts: 0,
        totalCorrectElapsedMs: 0,
      });
    });
  });

  it('redondea porcentajes a un decimal', () => {
    expect(accuracyPercent(1, 3)).toBe(33.3);
    expect(accuracyPercent(2, 3)).toBe(66.7);
    expect(accuracyPercent(3, 3)).toBe(100);
  });

  it('agrega métricas sin perder el total de tiempos (promedio ponderado exacto)', () => {
    const a = { ...emptyMetrics(), attempts: 2, correct: 2, totalCorrectElapsedMs: 10_000, points: 250 };
    const b = { ...emptyMetrics(), attempts: 1, correct: 1, totalCorrectElapsedMs: 4_000, points: 100 };
    const sum = addMetrics(a, b);
    expect(sum).toMatchObject({ attempts: 3, correct: 3, points: 350, totalCorrectElapsedMs: 14_000 });
    expect(averageCorrectMs(sum.totalCorrectElapsedMs, sum.correct)).toBe(4_667);
  });

  describe('estudiantes que requieren atención', () => {
    const t = { minAttempts: 5, lowAccuracyBelow: 50, repeatedFailures: 3 };

    it('marca precisión baja solo con datos suficientes', () => {
      expect(attentionReasons({ attempts: 4, accuracyPercent: 0, consecutiveFailures: 0 }, t)).toEqual([]);
      expect(attentionReasons({ attempts: 5, accuracyPercent: 40, consecutiveFailures: 0 }, t)).toEqual([
        'LOW_ACCURACY',
      ]);
      expect(attentionReasons({ attempts: 10, accuracyPercent: 50, consecutiveFailures: 0 }, t)).toEqual([]);
    });

    it('marca fallos consecutivos aunque haya pocos intentos', () => {
      expect(attentionReasons({ attempts: 3, accuracyPercent: 0, consecutiveFailures: 3 }, t)).toEqual([
        'REPEATED_FAILURES',
      ]);
      expect(attentionReasons({ attempts: 3, accuracyPercent: 0, consecutiveFailures: 2 }, t)).toEqual([]);
    });

    it('puede devolver ambos motivos y nunca marca a quien no ha jugado', () => {
      expect(attentionReasons({ attempts: 8, accuracyPercent: 25, consecutiveFailures: 4 }, t)).toEqual([
        'LOW_ACCURACY',
        'REPEATED_FAILURES',
      ]);
      expect(attentionReasons({ attempts: 0, accuracyPercent: null, consecutiveFailures: 0 }, t)).toEqual([]);
    });
  });
});
