import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// Parámetros scrypt (OWASP: N >= 2^15, r = 8, p = 1). Se guardan en el hash para poder subirlos en el futuro.
const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1 } as const;
const MAX_MEM = 128 * 1024 * 1024;

type ScryptParams = { N: number; r: number; p: number };

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Hash de contraseñas con `scrypt` nativo de Node (sin dependencias nativas).
 * Formato: `scrypt$N$r$p$<salt base64>$<hash base64>`.
 */
export class PasswordHasher {
  constructor(private readonly params: ScryptParams = DEFAULT_PARAMS) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, this.params);
    const { N, r, p } = this.params;
    return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (![params.N, params.r, params.p].every(Number.isInteger)) return false;
    const expected = Buffer.from(hash, 'base64');
    let actual: Buffer;
    try {
      actual = await derive(password, Buffer.from(salt, 'base64'), params);
    } catch {
      // Parámetros inválidos o que exceden la memoria permitida (hash corrupto): no coincide, no es un error 500.
      return false;
    }
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
