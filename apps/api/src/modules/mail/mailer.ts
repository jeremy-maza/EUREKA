/** Correo saliente, independiente del proveedor. Solo texto plano: basta para enlaces de recuperación. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Puerto de salida de correo. Para integrar un proveedor real (SES, SendGrid, SMTP…) basta con implementar esta
 * clase y registrarla en `MailModule` (ver docs/authentication.md, "Configurar un proveedor de correo").
 * `send` debe rechazar la promesa si el proveedor falla; el llamador decide cómo reaccionar.
 */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
