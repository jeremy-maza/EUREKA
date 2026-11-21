import { Logger } from '@nestjs/common';
import { ConsoleMailer } from './console.mailer';
import { DisabledMailer } from './disabled.mailer';
import { createMailer } from './mail.module';

const message = {
  to: 'ana@example.com',
  subject: 'Restablece tu contraseña',
  text: 'Enlace: https://app.example.com/reset#token=SECRET-TOKEN-VALUE',
};

describe('Mailer', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('por defecto es "disabled" y NO registra el cuerpo ni el destinatario (contiene el token)', async () => {
    const mailer = createMailer(undefined, 'production');
    expect(mailer).toBeInstanceOf(DisabledMailer);
    await mailer.send(message);
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('NO enviado');
    expect(logged).not.toContain('SECRET-TOKEN-VALUE');
    expect(logged).not.toContain('ana@example.com');
  });

  it('"console" imprime el correo completo en desarrollo', async () => {
    const mailer = createMailer('console', 'development');
    expect(mailer).toBeInstanceOf(ConsoleMailer);
    await mailer.send(message);
    expect(warn.mock.calls.flat().join(' ')).toContain('SECRET-TOKEN-VALUE');
  });

  it('"console" se niega a existir en producción', () => {
    expect(() => createMailer('console', 'production')).toThrow(/producción/);
    expect(() => new ConsoleMailer('production')).toThrow(/producción/);
  });

  it('rechaza transportes desconocidos', () => {
    expect(() => createMailer('smtp', 'development')).toThrow(/desconocido/);
  });
});
