import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

/** Cliente dentro de una transacción interactiva (`prisma.$transaction(async (tx) => …)`). */
export type DbClient = Prisma.TransactionClient;

/** Cliente Prisma 7 con el adaptador `pg`. La conexión es perezosa: la app arranca sin BD. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get<string>('DATABASE_URL'),
        // Tamaño máximo del pool de `pg` (por defecto el de `pg`: 10).
        max: config.get<number>('DATABASE_POOL_MAX'),
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
