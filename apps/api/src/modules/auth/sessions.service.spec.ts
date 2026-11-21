import { sanitizeUserAgent, sessionStatus } from './sessions.service';

describe('sanitizeUserAgent', () => {
  it('quita caracteres de control y trunca a 200', () => {
    expect(sanitizeUserAgent('Mozilla/5.0\r\nX-Injected: 1\u0000')).toBe('Mozilla/5.0X-Injected: 1');
    expect(sanitizeUserAgent('a'.repeat(500))).toHaveLength(200);
  });

  it('devuelve null si no hay valor útil', () => {
    expect(sanitizeUserAgent(undefined)).toBeNull();
    expect(sanitizeUserAgent('  \n ')).toBeNull();
  });
});

describe('sessionStatus', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  it('distingue vigente, caducada y revocada (la revocación manda)', () => {
    const future = new Date(now.getTime() + 1000);
    expect(sessionStatus({ revokedAt: null, expiresAt: future }, now)).toBe('ACTIVE');
    expect(sessionStatus({ revokedAt: null, expiresAt: now }, now)).toBe('EXPIRED');
    expect(sessionStatus({ revokedAt: now, expiresAt: future }, now)).toBe('REVOKED');
    expect(sessionStatus({ revokedAt: now, expiresAt: new Date(0) }, now)).toBe('REVOKED');
  });
});
