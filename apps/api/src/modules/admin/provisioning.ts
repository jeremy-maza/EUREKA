import { PasswordHasher } from '../auth/password-hasher';
import { UserRole } from '../../generated/prisma/client';
import { UserProfileDto, UsersService } from '../users';

export interface ProvisionUserInput {
  email: string;
  displayName: string;
  password: string;
  role: typeof UserRole.TEACHER | typeof UserRole.ADMIN;
}

/**
 * Creación de cuentas privilegiadas. Es la ÚNICA ruta del código que crea docentes o administradores y
 * no está expuesta públicamente: la usan `POST /admin/teachers` (solo ADMIN) y el script operativo
 * `npm run admin:create` (acceso al servidor). Reutiliza el hash de contraseñas y la unicidad de correo
 * del flujo de registro y nunca devuelve el hash.
 */
export async function provisionUser(
  users: UsersService,
  hasher: PasswordHasher,
  input: ProvisionUserInput,
): Promise<UserProfileDto> {
  const passwordHash = await hasher.hash(input.password);
  const user = await users.create({
    email: input.email,
    displayName: input.displayName,
    passwordHash,
    role: input.role,
  });
  return users.toProfile(user);
}
