import { formatMultiplier } from './format-multiplier';

describe('formatMultiplier', () => {
  it.each([
    [1000, '1'],
    [1500, '1.5'],
    [2000, '2'],
    [2500, '2.5'],
    [5000, '5'],
    [1250, '1.25'],
    [1005, '1.005'],
    [0, '0'],
  ])('%i → %s', (milli, text) => {
    expect(formatMultiplier(milli)).toBe(text);
  });
});
