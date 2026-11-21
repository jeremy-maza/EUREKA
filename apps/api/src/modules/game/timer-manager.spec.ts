import { DEFAULT_TIMER_CONFIG, TimerManager } from './timer-manager';

describe('TimerManager', () => {
  const timer = new TimerManager(DEFAULT_TIMER_CONFIG); // 60 s base, +15 s por regla

  it.each([
    [0, 60], // sin reglas (primer reto): tiempo base
    [1, 60],
    [2, 75],
    [3, 90],
    [10, 195],
  ])('%i reglas activas → %i s', (rules, seconds) => {
    expect(timer.calculateTimeLimitSeconds(rules)).toBe(seconds);
  });

  it('usa valores configurables, no constantes fijas', () => {
    const custom = new TimerManager({ baseTimeSeconds: 30, additionalTimePerRuleSeconds: 5 });
    expect(custom.calculateTimeLimitSeconds(4)).toBe(45);
  });

  it('calcula el plazo a partir del instante de inicio del servidor', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    expect(timer.calculateDeadline(start, 3).toISOString()).toBe('2026-01-01T00:01:30.000Z');
  });

  it('un envío en el instante exacto del plazo es a tiempo; un milisegundo después no', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const deadline = timer.calculateDeadline(start, 1);
    expect(timer.checkSubmission(start, deadline, deadline)).toEqual({ withinTime: true, elapsedMs: 60_000 });
    const late = new Date(deadline.getTime() + 1);
    expect(timer.checkSubmission(start, deadline, late).withinTime).toBe(false);
    expect(timer.isExpired(deadline, deadline)).toBe(false);
    expect(timer.isExpired(deadline, late)).toBe(true);
  });

  it('rechaza configuración y entradas inválidas', () => {
    expect(() => new TimerManager({ baseTimeSeconds: 0, additionalTimePerRuleSeconds: 1 })).toThrow(
      RangeError,
    );
    expect(() => new TimerManager({ baseTimeSeconds: 10, additionalTimePerRuleSeconds: -1 })).toThrow(
      RangeError,
    );
    expect(() => timer.calculateTimeLimitSeconds(-1)).toThrow(RangeError);
    expect(() => timer.calculateTimeLimitSeconds(1.5)).toThrow(RangeError);
  });
});
