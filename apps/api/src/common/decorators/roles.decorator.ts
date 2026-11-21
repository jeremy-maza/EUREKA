import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';

export const ROLES_KEY = 'roles';

/** Restringe un endpoint a los roles indicados (además de exigir autenticación). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
