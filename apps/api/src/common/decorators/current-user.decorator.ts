import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client';

/** Usuario autenticado y su sesión, cargados desde la BD por el guard JWT en cada petición. */
export class AuthenticatedUser {
  id!: string;
  email!: string;
  role!: UserRole;
}

/** Usuario autenticado + la sesión (claim `jti` del JWT) con la que se hizo esta petición. */
export class AuthenticatedSessionUser extends AuthenticatedUser {
  sessionId!: string;
}

export type AuthenticatedRequest = Request & { user: AuthenticatedSessionUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSessionUser => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
