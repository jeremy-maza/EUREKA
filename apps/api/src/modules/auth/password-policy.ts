import { BadRequestException } from '@nestjs/common';
import { COMMON_PASSWORDS } from './common-passwords';

export interface PasswordPolicyConfig {
  minLength: number;
  maxLength: number;
}

export interface PasswordContext {
  email?: string;
}

/**
 * Política de contraseñas (NIST SP 800-63B): longitud mínima configurable, tope de longitud para rechazar entradas
 * desmesuradas antes de gastar `scrypt`, y rechazo de las elecciones más predecibles. Deliberadamente SIN reglas de
 * composición (mayúsculas, símbolos…): empeoran la elección real de los usuarios. No recorta ni transforma la contraseña.
 */
export class PasswordPolicy {
  constructor(private readonly config: PasswordPolicyConfig) {}

  get minLength(): number {
    return this.config.minLength;
  }

  /** Lista de incumplimientos (vacía si la contraseña es aceptable). */
  violations(password: string, context: PasswordContext = {}): string[] {
    const problems: string[] = [];
    const { minLength, maxLength } = this.config;

    if (password.length < minLength)
      problems.push(`La contraseña debe tener al menos ${minLength} caracteres.`);
    if (password.length > maxLength)
      problems.push(`La contraseña no puede superar los ${maxLength} caracteres.`);
    if (problems.length > 0) return problems;

    const lowered = password.toLowerCase();
    if (password.trim().length === 0 || new Set(password).size === 1) {
      problems.push('La contraseña es demasiado predecible.');
    } else if (COMMON_PASSWORDS.has(lowered)) {
      problems.push('La contraseña es demasiado común.');
    } else if (context.email) {
      const email = context.email.trim().toLowerCase();
      if (lowered === email || lowered === email.split('@')[0]) {
        problems.push('La contraseña no puede ser igual a tu correo.');
      }
    }
    return problems;
  }

  /** @throws BadRequestException (400, lista de mensajes como la validación de DTO). */
  assert(password: string, context: PasswordContext = {}): void {
    const problems = this.violations(password, context);
    if (problems.length > 0) throw new BadRequestException(problems);
  }
}
