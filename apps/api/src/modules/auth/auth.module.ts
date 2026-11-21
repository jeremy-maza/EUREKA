import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Clock } from '../../common';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { MailModule } from '../mail';
import { UsersModule } from '../users';
import { AuthMaintenanceService } from './auth-maintenance.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordController } from './password.controller';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { AuthSessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { ThrottleService } from './throttle.service';
import { TokenService } from './token.service';

@Module({
  imports: [UsersModule, MailModule],
  controllers: [AuthController, PasswordController, SessionsController],
  providers: [
    AuthService,
    PasswordService,
    AuthSessionsService,
    ThrottleService,
    AuthMaintenanceService,
    {
      provide: AUTH_CONFIG,
      useFactory: (config: ConfigService) => config.getOrThrow<AuthConfig>('auth'),
      inject: [ConfigService],
    },
    {
      provide: PasswordPolicy,
      useFactory: (config: AuthConfig) => new PasswordPolicy(config.password),
      inject: [AUTH_CONFIG],
    },
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    {
      provide: TokenService,
      useFactory: (config: ConfigService, clock: Clock) =>
        new TokenService(
          config.getOrThrow<string>('JWT_SECRET'),
          config.get<number>('JWT_EXPIRES_IN_SECONDS', 3600),
          clock,
        ),
      inject: [ConfigService, Clock],
    },
    // Orden de ejecución: primero autenticación, luego roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [
    TokenService,
    PasswordHasher,
    PasswordPolicy,
    AuthSessionsService,
    ThrottleService,
    AuthMaintenanceService,
  ],
})
export class AuthModule {}
