import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import authConfig from './config/auth.config';
import gameConfig from './config/game.config';
import { HealthModule } from './health/health.module';
import { CommonModule } from './common';
import { AdminModule } from './modules/admin';
import { AuthModule } from './modules/auth';
import { GameModule } from './modules/game';
import { GroupsModule } from './modules/groups';
import { TeacherDashboardModule } from './modules/teacher-dashboard';
import { UsersModule } from './modules/users';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
      load: [gameConfig, authConfig],
    }),
    PrismaModule,
    CommonModule,
    HealthModule,
    UsersModule,
    AuthModule,
    GameModule,
    GroupsModule,
    AdminModule,
    TeacherDashboardModule,
  ],
})
export class AppModule {}
