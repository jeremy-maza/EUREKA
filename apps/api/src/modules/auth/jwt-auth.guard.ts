import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthenticatedRequest, IS_PUBLIC_KEY } from '../../common';
import { UsersService } from '../users';
import { InvalidTokenError, TokenService } from './token.service';

/**
 * Guard global: todo endpoint exige un Bearer JWT válido salvo los marcados con `@Public()`.
 * Tras validar el token recarga al usuario de la BD, de modo que cuentas eliminadas o cambios de
 * rol surten efecto de inmediato (no se confía en el rol "congelado" dentro del token).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
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

    let userId: string;
    try {
      userId = this.tokens.verify(token).sub;
    } catch (error) {
      if (error instanceof InvalidTokenError) throw new UnauthorizedException(error.message);
      throw error;
    }

    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('El usuario ya no existe.');
    (request as AuthenticatedRequest).user = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
