import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock, cursorArgs, toPage } from '../../common';
import { AuthSession, SessionRevocationReason, User, UserRole } from '../../generated/prisma/client';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { ListSessionsQueryDto, SessionDto, SessionPageDto, SessionStatus } from './dto/session.dto';
import { TokenService } from './token.service';

export interface SessionClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  sessionId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_USER_AGENT_LENGTH = 200;

/** Quita caracteres de control y trunca: el User-Agent lo controla el cliente y solo se usa como etiqueta. */
export function sanitizeUserAgent(userAgent: string | undefined): string | null {
  const clean = [...(userAgent ?? '')]
    .filter((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f)
    .join('')
    .trim()
    .slice(0, MAX_USER_AGENT_LENGTH);
  return clean === '' ? null : clean;
}

export function sessionStatus(
  session: Pick<AuthSession, 'revokedAt' | 'expiresAt'>,
  now: Date,
): SessionStatus {
  if (session.revokedAt) return 'REVOKED';
  return session.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE';
}

/**
 * Ciclo de vida de las sesiones: una fila `AuthSession` por JWT emitido (su `id` es el `jti`). El JWT nunca se guarda.
 * Una petición solo se autentica si la sesión existe, pertenece al `sub` del token, no está revocada y no ha caducado.
 */
@Injectable()
export class AuthSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  /**
   * Crea la sesión y su JWT. `expectedPasswordHash` es el hash contra el que se verificó la contraseña: la sesión
   * solo se crea si sigue siendo el vigente, bajo `FOR SHARE` sobre la fila del usuario. Así un login que verificó la
   * contraseña ANTES de un cambio/recuperación concurrente no puede sobrevivir a la revocación masiva de ese cambio
   * (el cambio bloquea la misma fila al actualizarla y su revocación ve la sesión ya confirmada, o este login espera,
   * vuelve a evaluar la condición y falla). Devuelve `null` si la contraseña cambió entretanto.
   */
  async issue(
    user: Pick<User, 'id' | 'role' | 'passwordHash'>,
    meta: SessionClientMeta = {},
  ): Promise<IssuedSession | null> {
    const sessionId = randomUUID();
    const token = this.tokens.issue({ sub: user.id, role: user.role as UserRole, jti: sessionId });

    const created = await this.prisma.$transaction(async (tx) => {
      const current = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${user.id}::uuid AND "passwordHash" = ${user.passwordHash} FOR SHARE`;
      if (current.length === 0) return false;
      await tx.authSession.create({
        data: {
          id: sessionId,
          userId: user.id,
          createdAt: token.issuedAt,
          expiresAt: token.expiresAt,
          ipAddress: meta.ip ?? null,
          userAgent: sanitizeUserAgent(meta.userAgent),
        },
      });
      return true;
    });
    return created ? { accessToken: token.accessToken, expiresIn: token.expiresIn, sessionId } : null;
  }

  /** Sesión + usuario si el `jti` es una sesión vigente de `userId`; `null` en cualquier otro caso (indistinguible). */
  async authenticate(jti: string, userId: string): Promise<{ user: User; session: AuthSession } | null> {
    if (!UUID.test(jti)) return null;
    const session = await this.prisma.authSession.findUnique({ where: { id: jti }, include: { user: true } });
    if (!session || session.userId !== userId) return null;
    if (sessionStatus(session, this.clock.now()) !== 'ACTIVE') return null;
    const { user, ...rest } = session;
    return { user, session: rest };
  }

  async list(userId: string, query: ListSessionsQueryDto, currentSessionId: string): Promise<SessionPageDto> {
    const now = this.clock.now();
    const rows = await this.prisma.authSession.findMany({
      where: {
        userId,
        ...(query.status === 'ACTIVE' ? { revokedAt: null, expiresAt: { gt: now } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((row) => this.toDto(row, currentSessionId, now)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Revoca una sesión PROPIA (idempotente: una ya revocada o caducada no es un error). Una sesión ajena o
   * inexistente responde igual (404), sin revelar que existe.
   */
  async revokeOwn(userId: string, sessionId: string, reason: SessionRevocationReason): Promise<void> {
    if (!UUID.test(sessionId)) throw new NotFoundException('Sesión no encontrada.');
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada.');
    const now = this.clock.now();
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });
  }

  /** Revoca todas las sesiones vigentes del usuario. Acepta un cliente de transacción para hacerlo atómico con otros cambios. */
  async revokeAll(
    userId: string,
    reason: SessionRevocationReason,
    db: DbClient | PrismaService = this.prisma,
  ): Promise<number> {
    const now = this.clock.now();
    const { count } = await db.authSession.updateMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revocationReason: reason },
    });
    return count;
  }

  private toDto(row: AuthSession, currentSessionId: string, now: Date): SessionDto {
    return {
      id: row.id,
      status: sessionStatus(row, now),
      current: row.id === currentSessionId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      revocationReason: row.revocationReason,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
    };
  }
}
