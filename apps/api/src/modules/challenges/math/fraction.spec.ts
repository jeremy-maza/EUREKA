import { Fraction } from './fraction';

describe('Fraction', () => {
  it('normaliza signo y factor común', () => {
    expect(Fraction.of(6, -4).toString()).toBe('-3/2');
    expect(Fraction.of(0, 7).toString()).toBe('0');
    expect(Fraction.of(10, 5).isInteger()).toBe(true);
  });

  it('opera sin errores de coma flotante', () => {
    const tenth = Fraction.of(1, 10);
    const sum = tenth.add(Fraction.of(2, 10));
    expect(sum.equals(Fraction.of(3, 10))).toBe(true); // 0.1 + 0.2 === 0.3 en exacto
  });

  it('divide por cero lanza error', () => {
    expect(() => Fraction.of(1).divide(Fraction.of(0))).toThrow('dividir entre cero');
    expect(() => Fraction.of(1, 0)).toThrow('dividir entre cero');
  });

  it('parse es inverso de toString', () => {
    for (const text of ['21', '-3', '7/2', '-7/2']) {
      expect(Fraction.parse(text).toString()).toBe(text);
    }
    expect(() => Fraction.parse('abc')).toThrow();
  });
});
