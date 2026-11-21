import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Clock } from '../../common';
import { UsersModule } from '../users';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordHasher } from './password-hasher';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
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
  exports: [TokenService],
})
export class AuthModule {}
