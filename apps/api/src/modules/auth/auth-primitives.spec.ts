import { createHmac } from 'node:crypto';
import { Clock } from '../../common';
import { PasswordHasher } from './password-hasher';
import { InvalidTokenError, TokenService } from './token.service';

class StubClock extends Clock {
  constructor(public current = new Date('2026-01-01T00:00:00.000Z')) {
    super();
  }
  now() {
    return new Date(this.current);
  }
}

const SECRET = 'unit-test-secret-with-more-than-32-characters';
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (input: string, secret = SECRET) =>
  createHmac('sha256', secret).update(input).digest('base64url');

describe('PasswordHasher', () => {
  // Parámetros reducidos para que la prueba sea rápida; la producción usa N = 2^15.
  const hasher = new PasswordHasher({ N: 1024, r: 8, p: 1 });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(await hasher.verify('correct horse battery', hash)).toBe(true);
    expect(await hasher.verify('wrong password', hash)).toBe(false);
  });

  it('usa sal aleatoria y no guarda la contraseña en claro', async () => {
    const [a, b] = await Promise.all([hasher.hash('same-password'), hasher.hash('same-password')]);
    expect(a).not.toBe(b);
    expect(a).not.toContain('same-password');
    expect(a.startsWith('scrypt$1024$8$1$')).toBe(true);
  });

  it('rechaza formatos de hash corruptos sin lanzar', async () => {
    for (const bad of ['', 'plain', 'scrypt$x$y$z$a$b', 'bcrypt$1$2$3$a$b', 'scrypt$1024$8$1$$']) {
      expect(await hasher.verify('x', bad)).toBe(false);
    }
  });
});

describe('TokenService (JWT HS256)', () => {
  const clock = new StubClock();
  const tokens = new TokenService(SECRET, 3600, clock);
  const payload = { sub: 'user-1', role: 'STUDENT' as const };

  it('emite y verifica un token', () => {
    const { accessToken, expiresIn } = tokens.issue(payload);
    expect(expiresIn).toBe(3600);
    expect(accessToken.split('.')).toHaveLength(3);
    expect(tokens.verify(accessToken)).toEqual(payload);
  });

  it('rechaza un token expirado (según el reloj del servidor)', () => {
    const { accessToken } = tokens.issue(payload);
    clock.current = new Date(clock.current.getTime() + 3600 * 1000);
    expect(() => tokens.verify(accessToken)).toThrow('Token expirado.');
    clock.current = new Date('2026-01-01T00:00:00.000Z');
  });

  it('rechaza firma manipulada y payload alterado', () => {
    const [h, , s] = tokens.issue(payload).accessToken.split('.');
    const forgedBody = b64url({ sub: 'admin', role: 'ADMIN', iat: 0, exp: 9_999_999_999 });
    expect(() => tokens.verify(`${h}.${forgedBody}.${s}`)).toThrow(InvalidTokenError);
  });

  it('rechaza un token firmado con otro secreto', () => {
    const other = new TokenService('another-secret-that-is-long-enough-123456', 3600, clock);
    expect(() => tokens.verify(other.issue(payload).accessToken)).toThrow(InvalidTokenError);
  });

  it('rechaza alg "none" y otros algoritmos aunque la firma sea válida para el contenido', () => {
    const claims = { sub: 'u', role: 'ADMIN', iat: 0, exp: 9_999_999_999 };
    const none = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`;
    expect(() => tokens.verify(none)).toThrow(InvalidTokenError);

    const header = b64url({ alg: 'HS512', typ: 'JWT' });
    const body = b64url(claims);
    expect(() => tokens.verify(`${header}.${body}.${sign(`${header}.${body}`)}`)).toThrow(InvalidTokenError);
  });

  it('rechaza tokens sin exp o con claims inválidos aunque estén bien firmados', () => {
    const header = b64url({ alg: 'HS256', typ: 'JWT' });
    for (const claims of [
      { sub: 'u', role: 'STUDENT' },
      { role: 'STUDENT', exp: 9_999_999_999 },
      { sub: 1, role: 'STUDENT', exp: 9_999_999_999 },
    ]) {
      const body = b64url(claims);
      expect(() => tokens.verify(`${header}.${body}.${sign(`${header}.${body}`)}`)).toThrow(
        InvalidTokenError,
      );
    }
  });

  it.each(['', 'abc', 'a.b', 'a.b.c.d', 'a.b.c'])('rechaza el token mal formado "%s"', (token) => {
    expect(() => tokens.verify(token)).toThrow(InvalidTokenError);
  });

  it('exige un secreto largo y un TTL válido', () => {
    expect(() => new TokenService('short', 3600, clock)).toThrow(RangeError);
    expect(() => new TokenService(SECRET, 0, clock)).toThrow(RangeError);
  });
});
