import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import gameConfig from './config/game.config';
import { HealthModule } from './health/health.module';
import { GameModule } from './modules/game';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
      load: [gameConfig],
    }),
    PrismaModule,
    HealthModule,
    GameModule,
  ],
})
export class AppModule {}
