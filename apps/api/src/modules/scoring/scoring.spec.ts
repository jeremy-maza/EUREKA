import { ScoringEngine } from './scoring-engine';
import { StreakManager } from './streak-manager';

const streaks = new StreakManager();
const scoring = new ScoringEngine({ basePoints: 100 }, streaks);

describe('StreakManager — M(n) = min(1 + 0.5·(n−1), 5)', () => {
  it.each([
    [1, 1000],
    [2, 1500],
    [3, 2000],
    [4, 2500],
    [5, 3000],
    [8, 4500],
    [9, 5000],
    [10, 5000],
    [500, 5000],
  ])('acierto consecutivo %i → %i milésimas', (n, milli) => {
    expect(streaks.multiplierMilliFor(n)).toBe(milli);
  });

  it('rechaza n inválido y configuración inválida', () => {
    expect(() => streaks.multiplierMilliFor(0)).toThrow(RangeError);
    expect(() => new StreakManager({ multiplierStepMilli: 500, maxMultiplierMilli: 500 })).toThrow(
      RangeError,
    );
  });

  it('un fallo reinicia la racha a 0', () => {
    expect(streaks.onCorrect(4)).toBe(5);
    expect(streaks.onFailure()).toBe(0);
  });
});

describe('ScoringEngine', () => {
  it('otorga puntos base × multiplicador con enteros exactos', () => {
    const awards = [0, 1, 2, 3, 4].map((streak) => scoring.scoreCorrect(streak));
    expect(awards.map((a) => a.points)).toEqual([100, 150, 200, 250, 300]);
    expect(awards.map((a) => a.streakAfter)).toEqual([1, 2, 3, 4, 5]);
    expect(awards[1]).toMatchObject({ basePoints: 100, multiplierMilli: 1500 });
  });

  it('el multiplicador se detiene en 5x', () => {
    expect(scoring.scoreCorrect(8).points).toBe(500);
    expect(scoring.scoreCorrect(9).points).toBe(500);
    expect(scoring.scoreCorrect(99).points).toBe(500);
  });

  it('trunca de forma determinista cuando no es exacto (sin coma flotante)', () => {
    const odd = new ScoringEngine({ basePoints: 7 }, streaks);
    expect(odd.scoreCorrect(1).points).toBe(10); // 7 × 1.5 = 10.5 → 10
    expect(odd.scoreCorrect(2).points).toBe(14); // 7 × 2
    const tricky = new ScoringEngine({ basePoints: 1_000_000_007 }, streaks);
    expect(tricky.scoreCorrect(1).points).toBe(1_500_000_010); // 1_500_000_010.5 → 1_500_000_010
  });

  it('un fallo no otorga puntos y reinicia la racha', () => {
    expect(scoring.scoreFailure()).toEqual({ basePoints: 0, multiplierMilli: 0, points: 0, streakAfter: 0 });
  });

  it('rechaza puntos base inválidos', () => {
    expect(() => new ScoringEngine({ basePoints: -1 }, streaks)).toThrow(RangeError);
    expect(() => new ScoringEngine({ basePoints: 1.5 }, streaks)).toThrow(RangeError);
  });
});
