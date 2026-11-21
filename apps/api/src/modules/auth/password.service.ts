import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  UnauthorizedException,
} from '@nestjs/common';
import { Clock, TooManyRequestsException } from '../../common';
import { AUTH_CONFIG } from '../../config/auth.config';
import type { AuthConfig } from '../../config/auth.config';
import { SessionRevocationReason, ThrottleScope } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Mailer } from '../mail';
import { UsersService } from '../users';
import { normalizeClientIp } from './client-ip';
import type { ChangePasswordDto, ResetPasswordDto } from './dto/password.dto';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy';
import { buildPasswordResetEmail } from './password-reset.email';
import { generateResetToken, hashResetToken } from './reset-token';
import { AuthSessionsService } from './sessions.service';
import { ThrottleService } from './throttle.service';
import { emailThrottleKey, ipEmailThrottleKey } from './throttle-keys';

/** Mensaje único para cualquier token inservible (inexistente, caducado, usado o sustituido): no distingue casos. */
export const INVALID_RESET_TOKEN = 'El enlace de recuperación no es válido o ha caducado.';

/**
 * Cambio y recuperación de contraseña. Invariantes:
 *  - La contraseña y la revocación de TODAS las sesiones cambian en una única transacción.
 *  - El token de recuperación se reclama con un `UPDATE … WHERE consumedAt IS NULL AND expiresAt > now` atómico: dos
 *    envíos concurrentes no pueden consumirlo dos veces. `scrypt` se ejecuta fuera de la transacción.
 *  - Solo se guarda el SHA-256 del token; el token en claro únicamente existe en el correo.
 */
@Injectable()
export class PasswordService implements OnApplicationShutdown {
  private readonly logger = new Logger(PasswordService.name);
  private readonly pendingMail = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    private readonly sessions: AuthSessionsService,
    private readonly throttle: ThrottleService,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  // ───────────────────────────── Cambio de contraseña (autenticado) ─────────────────────────────

  async changePassword(current: { id: string }, dto: ChangePasswordDto): Promise<void> {
    // Los intentos con la contraseña actual también se limitan: un token robado no debe servir para adivinarla.
    const verdict = await this.throttle.charge([
      { scope: ThrottleScope.PASSWORD_CHANGE_USER, key: current.id, policy: this.config.passwordChange },
    ]);
    if (!verdict.allowed) throw new TooManyRequestsException(verdict.retryAfterSeconds);

    const user = await this.users.findById(current.id);
    if (!user) throw new UnauthorizedException('Sesión no válida o revocada.');

    if (!(await this.hasher.verify(dto.currentPassword, user.passwordHash))) {
      throw new ForbiddenException('La contraseña actual es incorrecta.');
    }
    this.policy.assert(dto.newPassword, { email: user.email });
    if (await this.hasher.verify(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('La nueva contraseña debe ser distinta de la actual.');
    }

    const newHash = await this.hasher.hash(dto.newPassword);
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      // Condición sobre el hash anterior: si otro cambio/recuperación se coló entre la verificación y aquí, no se pisa.
      const updated = await tx.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash: newHash },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'La contraseña cambió mientras se procesaba la solicitud. Inténtalo de nuevo.',
        );
      }
      await this.sessions.revokeAll(user.id, SessionRevocationReason.PASSWORD_CHANGED, tx);
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
    });

    await this.throttle.clear(ThrottleScope.PASSWORD_CHANGE_USER, user.id).catch(() => undefined);
    this.logger.log(`Contraseña cambiada (userId=${user.id}); sesiones revocadas.`);
  }

  // ───────────────────────────── Recuperación: solicitud ─────────────────────────────

  /**
   * Siempre completa igual (la respuesta HTTP es genérica) exista o no la cuenta. Lo único observable desde fuera es el
   * 429 por IP, que no depende de la cuenta. El correo se entrega en segundo plano: su latencia no distingue casos.
   */
  async requestReset(rawEmail: string, rawIp: string | undefined): Promise<void> {
    const verdict = await this.throttle.charge([
      {
        scope: ThrottleScope.PASSWORD_RESET_REQUEST_IP,
        key: normalizeClientIp(rawIp),
        policy: this.config.passwordReset.requestsPerIp,
      },
    ]);
    if (!verdict.allowed) throw new TooManyRequestsException(verdict.retryAfterSeconds);

    const user = await this.users.findByEmail(rawEmail);
    if (!user) return;

    const now = this.clock.now();
    const token = generateResetToken();
    const created = await this.prisma.$transaction(async (tx) => {
      // Serializa las solicitudes concurrentes de un mismo usuario (NO KEY UPDATE no bloquea inserciones con FK).
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR NO KEY UPDATE`;

      const cooldownStart = new Date(now.getTime() - this.config.passwordReset.cooldownSeconds * 1000);
      const recent = await tx.passwordResetToken.findFirst({
        where: {
          userId: user.id,
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: now },
          createdAt: { gt: cooldownStart },
        },
        select: { id: true },
      });
      if (recent) return false; // ya se envió uno hace poco: no se reenvía (anti mail-bombing)

      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashResetToken(token),
          createdAt: now,
          expiresAt: new Date(now.getTime() + this.config.passwordReset.ttlSeconds * 1000),
        },
      });
      return true;
    });
    if (!created) return;

    const message = buildPasswordResetEmail({
      to: user.email,
      urlBase: this.config.passwordReset.urlBase,
      token,
      ttlMinutes: Math.round(this.config.passwordReset.ttlSeconds / 60),
    });
    this.deliverInBackground(user.id, message);
  }

  // ───────────────────────────── Recuperación: restablecimiento ─────────────────────────────

  async resetPassword(dto: ResetPasswordDto, rawIp: string | undefined): Promise<void> {
    const tokenHash = hashResetToken(dto.token);
    const now = this.clock.now();

    // Comprobación barata ANTES de gastar `scrypt`: un token inservible no cuesta CPU.
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!record || record.consumedAt || record.invalidatedAt || record.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(INVALID_RESET_TOKEN);
    }
    this.policy.assert(dto.newPassword, { email: record.user.email });
    const newHash = await this.hasher.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      // Reclamo atómico (autoridad final): bajo concurrencia, solo una transacción ve `consumedAt IS NULL`.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException(INVALID_RESET_TOKEN);

      await tx.user.update({ where: { id: record.userId }, data: { passwordHash: newHash } });
      await this.sessions.revokeAll(record.userId, SessionRevocationReason.PASSWORD_RESET, tx);
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
    });

    // Quien demuestra control del correo no debe seguir bloqueado por sus propios intentos fallidos.
    await Promise.all([
      this.throttle.clear(ThrottleScope.LOGIN_EMAIL, emailThrottleKey(record.user.email)),
      this.throttle.clear(ThrottleScope.LOGIN_IP_EMAIL, ipEmailThrottleKey(rawIp, record.user.email)),
      this.throttle.clear(ThrottleScope.PASSWORD_CHANGE_USER, record.userId),
    ]).catch(() => undefined);
    this.logger.log(
      `Contraseña restablecida por recuperación (userId=${record.userId}); sesiones revocadas.`,
    );
  }

  // ───────────────────────────── Entrega de correo ─────────────────────────────

  private deliverInBackground(userId: string, message: Parameters<Mailer['send']>[0]): void {
    const task = Promise.resolve()
      .then(() => this.mailer.send(message))
      .catch((error: unknown) => {
        // Nunca se registra el mensaje (contiene el token) ni el destinatario.
        this.logger.error(
          `Falló la entrega del correo de recuperación (userId=${userId}): ${(error as Error)?.message}`,
        );
      })
      .finally(() => this.pendingMail.delete(task));
    this.pendingMail.add(task);
  }

  /** Espera a las entregas en curso (apagado ordenado y pruebas). */
  async drainPendingMail(): Promise<void> {
    await Promise.all([...this.pendingMail]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drainPendingMail();
  }
}
