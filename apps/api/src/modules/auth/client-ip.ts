import { isIPv4, isIPv6 } from 'node:net';

/**
 * Normaliza la IP del cliente para usarla como clave de limitación:
 *  - `::ffff:1.2.3.4` (IPv4 mapeada) → `1.2.3.4`.
 *  - IPv6 → su prefijo /64 (un cliente IPv6 controla un /64 entero; limitar por dirección completa sería trivial de eludir).
 *  - Cualquier otra cosa → `unknown` (cubo compartido; nunca se confía en texto arbitrario como clave).
 * La IP debe venir de `request.ip`, que respeta `TRUST_PROXY`; jamás se lee `X-Forwarded-For` a mano.
 */
export function normalizeClientIp(ip: string | undefined | null): string {
  if (!ip) return 'unknown';
  const value = ip.trim().toLowerCase().split('%')[0];

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (isIPv4(value)) return value;
  if (!isIPv6(value)) return 'unknown';

  const [head, tail] = value.split('::');
  const toGroups = (part: string | undefined): string[] => {
    const groups = part ? part.split(':') : [];
    const last = groups[groups.length - 1];
    if (last?.includes('.')) {
      const [a, b, c, d] = last.split('.').map(Number);
      groups.splice(-1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
    }
    return groups;
  };
  const headGroups = toGroups(head);
  const tailGroups = tail === undefined ? [] : toGroups(tail);
  const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  const full = [...headGroups, ...Array<string>(Math.max(0, missing)).fill('0'), ...tailGroups];
  return `${full
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}
