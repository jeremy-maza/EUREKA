import { BadRequestException } from '@nestjs/common';
import { PasswordPolicy } from './password-policy';
import { generateResetToken, hashResetToken } from './reset-token';

describe('PasswordPolicy', () => {
  const policy = new PasswordPolicy({ minLength: 10, maxLength: 128 });

  it('acepta frases largas sin exigir composición (mayúsculas, símbolos…)', () => {
    expect(policy.violations('todas minusculas y largas')).toEqual([]);
    expect(policy.violations('a'.repeat(9) + 'b')).toEqual([]);
  });

  it('exige la longitud mínima configurable y respeta el máximo', () => {
    expect(policy.violations('corta123')[0]).toMatch(/al menos 10/);
    expect(new PasswordPolicy({ minLength: 14, maxLength: 128 }).violations('doce-chars-ok')[0]).toMatch(
      /al menos 14/,
    );
    expect(policy.violations('x'.repeat(129))[0]).toMatch(/superar los 128/);
    expect(policy.violations('x1'.repeat(64))).toEqual([]); // exactamente 128
  });

  it('rechaza contraseñas comunes sin distinguir mayúsculas', () => {
    const lenient = new PasswordPolicy({ minLength: 8, maxLength: 128 });
    for (const bad of ['password123', 'PASSWORD123', '12345678', 'Qwertyuiop', 'contraseña1']) {
      expect(lenient.violations(bad)).toEqual(['La contraseña es demasiado común.']);
    }
  });

  it('rechaza repeticiones de un solo carácter y contraseñas en blanco', () => {
    expect(policy.violations('aaaaaaaaaaaa')).toEqual(['La contraseña es demasiado predecible.']);
    expect(policy.violations('            ')).toEqual(['La contraseña es demasiado predecible.']);
  });

  it('rechaza la contraseña igual al correo o a su parte local', () => {
    expect(policy.violations('ana.garcia@example.com', { email: 'Ana.Garcia@Example.com' })).toEqual([
      'La contraseña no puede ser igual a tu correo.',
    ]);
    expect(policy.violations('ana.garcia.12', { email: 'ana.garcia.12@example.com' })).toEqual([
      'La contraseña no puede ser igual a tu correo.',
    ]);
    expect(policy.violations('ana.garcia@example.com')).toEqual([]);
  });

  it('assert lanza BadRequestException con la lista de mensajes', () => {
    expect(() => policy.assert('corta')).toThrow(BadRequestException);
    try {
      policy.assert('corta');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({ message: [expect.any(String)] });
    }
    expect(() => policy.assert('una frase suficientemente larga')).not.toThrow();
  });

  it('no incluye la contraseña en los mensajes', () => {
    expect(JSON.stringify(policy.violations('password123456789012345678901234'))).not.toContain(
      'password123',
    );
  });
});

describe('token de recuperación', () => {
  it('es aleatorio, de 256 bits y apto para URL', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateResetToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('se guarda como SHA-256 hexadecimal determinista que no contiene el token', () => {
    const token = generateResetToken();
    const hash = hashResetToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashResetToken(token));
    expect(hash).not.toContain(token);
    expect(hashResetToken(generateResetToken())).not.toBe(hash);
  });
});
