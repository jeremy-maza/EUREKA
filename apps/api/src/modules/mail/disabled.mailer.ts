import { Logger } from '@nestjs/common';
import { MailMessage, Mailer } from './mailer';

/**
 * Transporte por defecto: no entrega nada. Registra un aviso SIN destinatario ni cuerpo (el cuerpo contiene el
 * token de recuperación), de modo que operadores y desarrolladores sepan que falta configurar un proveedor.
 */
export class DisabledMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  send(message: MailMessage): Promise<void> {
    this.logger.warn(
      `Correo "${message.subject}" NO enviado: MAIL_TRANSPORT=disabled. Configura un proveedor de correo.`,
    );
    return Promise.resolve();
  }
}
