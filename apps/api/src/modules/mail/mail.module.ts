import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleMailer } from './console.mailer';
import { DisabledMailer } from './disabled.mailer';
import { Mailer } from './mailer';

/** Elige la implementación de `Mailer` según `MAIL_TRANSPORT`. Un proveedor real se añade como un `case` más. */
export function createMailer(transport: string | undefined, nodeEnv: string | undefined): Mailer {
  switch (transport ?? 'disabled') {
    case 'disabled':
      return new DisabledMailer();
    case 'console':
      return new ConsoleMailer(nodeEnv);
    default:
      throw new Error(`MAIL_TRANSPORT desconocido: "${transport}".`);
  }
}

@Module({
  providers: [
    {
      provide: Mailer,
      useFactory: (config: ConfigService) =>
        createMailer(config.get<string>('MAIL_TRANSPORT'), config.get<string>('NODE_ENV')),
      inject: [ConfigService],
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
