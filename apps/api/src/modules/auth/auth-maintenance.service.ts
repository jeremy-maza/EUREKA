import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Clock } from '../../common';
import { AUTH_CONFIG } from '../../config/auth.config';
import type { AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../prisma/prisma.service';
import { purgeAuthRecords } from './auth-cleanup';
import type { PurgeResult } from './auth-cleanup';

/**
 * Purga periódica opcional de registros de autenticación caducados (`AUTH_CLEANUP_INTERVAL_MINUTES`, 0 = desactivada;
 * nunca arranca en tests). Con varias instancias o sin proceso residente, usa `npm run auth:cleanup` desde un cron.
 */
@Injectable()
export class AuthMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthMaintenanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  onModuleInit(): void {
    const minutes = this.config.retention.cleanupIntervalMinutes;
    if (minutes <= 0 || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), minutes * 60_000);
    this.timer.unref(); // no impide que el proceso termine
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async purge(): Promise<PurgeResult> {
    return purgeAuthRecords(this.prisma, this.clock.now(), this.config.retention);
  }

  private async run(): Promise<void> {
    try {
      const result = await this.purge();
      this.logger.log(
        `Purga de autenticación: ${result.sessions} sesiones, ${result.resetTokens} tokens, ${result.throttles} contadores.`,
      );
    } catch (error) {
      this.logger.error(`Falló la purga de autenticación: ${(error as Error).message}`);
    }
  }
}
