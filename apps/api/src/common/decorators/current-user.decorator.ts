import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client';

/** Usuario autenticado, cargado desde la BD por el guard JWT en cada petición. */
export class AuthenticatedUser {
  id!: string;
  email!: string;
  role!: UserRole;
}

export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
