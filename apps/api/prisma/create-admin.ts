/**
 * Aprovisiona un administrador (o docente) desde la línea de comandos del servidor. Es la forma segura de crear
 * el PRIMER administrador: requiere acceso al servidor y a `DATABASE_URL`; no hay endpoint público para ello.
 *
 *   ADMIN_EMAIL=admin@example.com ADMIN_NAME="Admin" npm run admin:create -w apps/api
 *   (la contraseña se pide por consola sin eco; en CI puede pasarse con ADMIN_PASSWORD)
 *
 * Nunca promociona cuentas existentes: si el correo ya está registrado, falla.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { PrismaClient, UserRole } from '../src/generated/prisma/client';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { provisionUser } from '../src/modules/admin/provisioning';
import { UsersService } from '../src/modules/users/users.service';
import type { PrismaService } from '../src/prisma/prisma.service';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

const MIN_PASSWORD_LENGTH = 12;

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? (await ask('Correo del administrador: '));
  const displayName = process.env.ADMIN_NAME ?? (await ask('Nombre visible: '));
  const password = process.env.ADMIN_PASSWORD ?? (await ask('Contraseña (mín. 12 caracteres): ', true));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Correo inválido.');
  if (!displayName.trim()) throw new Error('El nombre es obligatorio.');
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    throw new Error(`La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y 128 caracteres.`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    // `UsersService` solo usa `prisma.user`; un PrismaClient plano le basta (sin contenedor de Nest).
    const users = new UsersService(prisma as unknown as PrismaService);
    const profile = await provisionUser(users, new PasswordHasher(), {
      email,
      displayName,
      password,
      role: UserRole.ADMIN,
    });
    console.log(`Administrador creado: ${profile.email} (id ${profile.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
