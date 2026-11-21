import { createHmac, timingSafeEqual } from 'node:crypto';
import { UserRole } from '../../generated/prisma/client';
import { Clock } from '../../common';

export interface TokenPayload {
  /** Id del usuario. */
  sub: string;
  role: UserRole;
}

export interface IssuedToken {
  accessToken: string;
  /** Segundos de validez. */
  expiresIn: number;
}

export class InvalidTokenError extends Error {
  constructor(message = 'Token inválido.') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

const HEADER = { alg: 'HS256', typ: 'JWT' } as const;

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/**
 * Emisión y verificación de JWT firmados con HS256 (RFC 7519) usando solo `node:crypto`.
 *
 * Es deliberadamente estricto: solo acepta `alg: HS256` (no existe `none` ni confusión de algoritmos),
 * compara la firma en tiempo constante y exige `exp`. El resto del sistema depende únicamente de
 * `issue`/`verify`, por lo que puede sustituirse por `@nestjs/jwt` o `jose` sin tocar nada más.
 */
export class TokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
    private readonly clock: Clock,
  ) {
    if (secret.length < 32) throw new RangeError('El secreto JWT debe tener al menos 32 caracteres.');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0)
      throw new RangeError('ttlSeconds debe ser un entero > 0.');
  }

  issue(payload: TokenPayload): IssuedToken {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const body = { sub: payload.sub, role: payload.role, iat, exp: iat + this.ttlSeconds };
    const signingInput = `${b64url(JSON.stringify(HEADER))}.${b64url(JSON.stringify(body))}`;
    return { accessToken: `${signingInput}.${this.sign(signingInput)}`, expiresIn: this.ttlSeconds };
  }

  /** @throws InvalidTokenError si el token está mal formado, la firma no coincide o expiró. */
  verify(token: string): TokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new InvalidTokenError();
    const [header, body, signature] = parts;

    const expected = Buffer.from(this.sign(`${header}.${body}`));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new InvalidTokenError();
    }

    const decodedHeader = this.parseJson(header);
    if (decodedHeader.alg !== HEADER.alg || decodedHeader.typ !== HEADER.typ) throw new InvalidTokenError();

    const claims = this.parseJson(body);
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds)
      throw new InvalidTokenError('Token expirado.');
    if (typeof claims.sub !== 'string' || typeof claims.role !== 'string') throw new InvalidTokenError();

    return { sub: claims.sub, role: claims.role as UserRole };
  }

  private sign(input: string): string {
    return createHmac('sha256', this.secret).update(input).digest('base64url');
  }

  private parseJson(segment: string): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
      if (typeof value === 'object' && value !== null && !Array.isArray(value))
        return value as Record<string, unknown>;
    } catch {
      /* se trata como token inválido */
    }
    throw new InvalidTokenError();
  }
}
