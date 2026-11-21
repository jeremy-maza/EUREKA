import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429 con `Retry-After` (lo añade el filtro global). Nest no trae esta excepción.
 * El mensaje es siempre genérico: no debe revelar qué contador (IP, correo…) provocó el bloqueo.
 */
export class TooManyRequestsException extends HttpException {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'Demasiados intentos. Inténtalo de nuevo más tarde.',
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
