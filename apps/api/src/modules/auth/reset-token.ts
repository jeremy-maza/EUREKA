import { createHash, randomBytes } from 'node:crypto';

/** Token de recuperación: 256 bits de CSPRNG en base64url (43 caracteres). Solo viaja por correo. */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 hexadecimal del token. Para un secreto de 256 bits de entropía basta un hash rápido (no hace falta
 * un KDF lento): su único fin es que una filtración de la BD no revele tokens utilizables.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
