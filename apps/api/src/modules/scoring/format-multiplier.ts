/** Formatea milésimas enteras como decimal legible sin usar coma flotante: 1500 → "1.5", 2000 → "2". */
export function formatMultiplier(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
