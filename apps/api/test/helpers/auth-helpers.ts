import { createHmac, randomUUID } from 'node:crypto';
import { UserRole } from '../../src/generated/prisma/client';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';
import { PASSWORD, TestContext } from './test-app';

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface LoginOptions {
  ip?: string;
  userAgent?: string;
}

/** POST /auth/login con IP de cliente (vía X-Forwarded-For; las pruebas activan TRUST_PROXY=1) y User-Agent opcionales. */
export function login(ctx: TestContext, email: string, password: string, opts: LoginOptions = {}) {
  let req = ctx.http().post('/api/auth/login');
  if (opts.ip) req = req.set('X-Forwarded-For', opts.ip);
  if (opts.userAgent) req = req.set('User-Agent', opts.userAgent);
  return req.send({ email, password });
}

/** Crea un usuario directamente en BD (rápido) con la contraseña dada. */
export async function createUser(
  ctx: TestContext,
  email: string,
  opts: { role?: UserRole; password?: string; displayName?: string } = {},
) {
  return ctx.prisma.user.create({
    data: {
      email,
      displayName: opts.displayName ?? 'Usuario',
      passwordHash: await new PasswordHasher().hash(opts.password ?? PASSWORD),
      role: opts.role ?? UserRole.STUDENT,
    },
  });
}

/** Crea el usuario e inicia sesión; devuelve su id y el token. */
export async function signIn(
  ctx: TestContext,
  email: string,
  opts: { role?: UserRole; password?: string; ip?: string; userAgent?: string } = {},
) {
  const user = await createUser(ctx, email, opts);
  const res = await login(ctx, email, opts.password ?? PASSWORD, opts).expect(200);
  return { userId: user.id, token: res.body.accessToken as string };
}

/** Decodifica el `jti` (id de sesión) de un JWT sin verificarlo. */
export function jtiOf(token: string): string {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).jti;
}

/** JWT con firma VÁLIDA (usa el secreto de pruebas) y claims arbitrarios: simula tokens antiguos o sesiones inexistentes. */
export function signedToken(claims: Record<string, unknown>): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  const signature = createHmac('sha256', process.env.JWT_SECRET!).update(input).digest('base64url');
  return `${input}.${signature}`;
}

export const randomSessionId = (): string => randomUUID();
