import { MailMessage, Mailer } from '../../src/modules/mail';

/** `Mailer` de pruebas: guarda los correos en memoria y permite extraer el token del enlace de recuperación. */
export class CapturingMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  failWith?: Error;

  send(message: MailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
    this.failWith = undefined;
  }

  /** Token del último correo enviado a `to` (el enlace lleva `#token=<token>`). */
  lastTokenFor(to: string): string | undefined {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    const match = message ? /#token=([A-Za-z0-9_-]+)/.exec(message.text) : null;
    return match?.[1];
  }
}
