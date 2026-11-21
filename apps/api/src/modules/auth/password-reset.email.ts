import { MailMessage } from '../mail';

/** Cuerpo del correo de recuperación. El token va en el FRAGMENTO (`#token=`): no llega a logs de servidores ni a `Referer`. */
export function buildPasswordResetEmail(input: {
  to: string;
  urlBase: string;
  token: string;
  ttlMinutes: number;
}): MailMessage {
  const link = `${input.urlBase}#token=${encodeURIComponent(input.token)}`;
  return {
    to: input.to,
    subject: 'Restablece tu contraseña de Matemática bajo reglas',
    text: [
      'Recibimos una solicitud para restablecer la contraseña de tu cuenta.',
      '',
      `Abre este enlace en los próximos ${input.ttlMinutes} minutos (solo funciona una vez):`,
      link,
      '',
      'Si no la solicitaste, ignora este mensaje: tu contraseña no cambiará.',
    ].join('\n'),
  };
}
