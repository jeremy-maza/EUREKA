import { Logger } from '@nestjs/common';
import { MailMessage, Mailer } from './mailer';

/**
 * SOLO DESARROLLO. Imprime el correo completo (incluido el enlace con el token de recuperación) en la consola
 * del servidor para poder probar el flujo sin proveedor. Se activa con `MAIL_TRANSPORT=console` y se niega a
 * existir en producción (la validación del entorno lo impide y este constructor lo vuelve a comprobar).
 */
export class ConsoleMailer extends Mailer {
  private readonly logger = new Logger('Mailer[DEV ONLY]');

  constructor(nodeEnv: string | undefined) {
    super();
    if (nodeEnv === 'production') throw new Error('ConsoleMailer no puede usarse en producción.');
  }

  send(message: MailMessage): Promise<void> {
    this.logger.warn(
      `\n--- correo (solo desarrollo) ---\nPara: ${message.to}\nAsunto: ${message.subject}\n\n${message.text}\n--------------------------------`,
    );
    return Promise.resolve();
  }
}
