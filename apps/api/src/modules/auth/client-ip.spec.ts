import { normalizeClientIp } from './client-ip';

describe('normalizeClientIp', () => {
  it('deja intactas las IPv4', () => {
    expect(normalizeClientIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('desenvuelve IPv4 mapeada en IPv6', () => {
    expect(normalizeClientIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeClientIp('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('agrupa IPv6 por prefijo /64 (un cliente controla todo su /64)', () => {
    const a = normalizeClientIp('2001:db8:abcd:12::1');
    const b = normalizeClientIp('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(b).toBe(a);
    expect(normalizeClientIp('2001:db8:abcd:13::1')).not.toBe(a);
  });

  it('expande "::" y descarta el identificador de zona', () => {
    expect(normalizeClientIp('::1')).toBe('0:0:0:0::/64');
    expect(normalizeClientIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(normalizeClientIp('2001:db8::')).toBe('2001:db8:0:0::/64');
  });

  it('usa un cubo compartido para valores ausentes o que no son IP', () => {
    for (const value of [undefined, null, '', 'not-an-ip', '999.1.1.1', "1.2.3.4'; DROP TABLE users;--"]) {
      expect(normalizeClientIp(value)).toBe('unknown');
    }
  });
});
