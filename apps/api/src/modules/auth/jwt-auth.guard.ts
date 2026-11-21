import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthenticatedRequest, IS_PUBLIC_KEY } from '../../common';
import { AuthSessionsService } from './sessions.service';
import { InvalidTokenError, TokenPayload, TokenService } from './token.service';

/**
 * Guard global: todo endpoint exige un Bearer JWT válido salvo los marcados con `@Public()`.
 * 1) Verifica firma, algoritmo y caducidad del JWT. 2) Exige que su `jti` sea una sesión vigente (existente, del mismo
 * usuario, no revocada, no caducada): un token revocado deja de funcionar al instante aunque su firma siga siendo válida.
 * 3) Usa al usuario cargado de la BD, de modo que cuentas eliminadas o cambios de rol surten efecto de inmediato
 * (no se confía en el rol "congelado" dentro del token).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: AuthSessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Falta el token de acceso.');

    let payload: TokenPayload;
    try {
      payload = this.tokens.verify(token);
    } catch (error) {
      if (error instanceof InvalidTokenError) throw new UnauthorizedException(error.message);
      throw error;
    }

    // Sesión desconocida, de otro usuario, revocada o caducada (o usuario borrado: la sesión cae en cascada).
    const authenticated = await this.sessions.authenticate(payload.jti, payload.sub);
    if (!authenticated) throw new UnauthorizedException('Sesión no válida o revocada.');
    const { user, session } = authenticated;
    (request as AuthenticatedRequest).user = {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    };
    return true;
  }
}
