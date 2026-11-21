import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsUrl,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

/** Prefijo del secreto de ejemplo de `.env.example`: válido en desarrollo, rechazado en producción. */
export const DEV_SECRET_PREFIX = 'dev-only-';

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Obligatoria salvo en tests (que no tocan la base de datos). */
  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV !== 'test')
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  /** Conexiones máximas del pool de PostgreSQL (opcional). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  DATABASE_POOL_MAX?: number;

  @IsString()
  @IsNotEmpty()
  CORS_ORIGIN: string = 'http://localhost:5173';

  // Configuración del juego (los valores por defecto viven en game.config.ts).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  GAME_BASE_TIME_SECONDS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  GAME_ADDITIONAL_TIME_PER_RULE_SECONDS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  GAME_BASE_POINTS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  GAME_STREAK_MULTIPLIER_STEP?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  GAME_MAX_STREAK_MULTIPLIER?: number;

  // Autenticación JWT.
  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  /** Validez del token de acceso, en segundos (por defecto 3600). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(2_592_000)
  JWT_EXPIRES_IN_SECONDS?: number;

  // ── Proxy inverso ──
  /** `false` (por defecto), nº de saltos de proxy, `loopback`, CIDR… Determina `request.ip` (clave del limitador). */
  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;

  // ── Política de contraseñas ──
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(8)
  @Max(64)
  PASSWORD_MIN_LENGTH?: number;

  // ── Limitación de intentos de login (todas opcionales; ver docs/authentication.md) ──
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  LOGIN_MAX_ATTEMPTS_IP_EMAIL?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  LOGIN_MAX_ATTEMPTS_EMAIL?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  LOGIN_MAX_ATTEMPTS_IP?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(86_400)
  LOGIN_WINDOW_SECONDS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86_400)
  LOGIN_LOCK_BASE_SECONDS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86_400)
  LOGIN_LOCK_MAX_SECONDS?: number;

  /** Intentos fallidos de la contraseña actual en `POST /auth/change-password` antes de bloquear. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  PASSWORD_CHANGE_MAX_ATTEMPTS?: number;

  // ── Recuperación de contraseña ──
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1_440)
  PASSWORD_RESET_TTL_MINUTES?: number;

  /** Mientras exista un token vigente creado hace menos de esto, no se genera ni envía otro (anti mail-bombing). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_600)
  PASSWORD_RESET_COOLDOWN_SECONDS?: number;

  /** Solicitudes de recuperación por IP y hora antes de responder 429. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  PASSWORD_RESET_MAX_REQUESTS_PER_IP?: number;

  /** URL del frontend para el enlace del correo (se le añade `#token=…`). Por defecto `<CORS_ORIGIN>/reset-password`. */
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  PASSWORD_RESET_URL?: string;

  // ── Correo y mantenimiento ──
  /** `disabled` (por defecto: no envía nada) o `console` (SOLO desarrollo: imprime el correo, token incluido). */
  @IsOptional()
  @IsIn(['disabled', 'console'])
  MAIL_TRANSPORT?: string;

  /** Días que se conservan sesiones y tokens caducados antes de purgarlos. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  AUTH_RETENTION_DAYS?: number;

  /** Cada cuántos minutos purga registros caducados esta instancia (0 = desactivado; usa `npm run auth:cleanup`). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_080)
  AUTH_CLEANUP_INTERVAL_MINUTES?: number;
}

/** Validador para `ConfigModule.forRoot({ validate })`: falla al arrancar con un mensaje claro. */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const instance = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: false });
  const errors = validateSync(instance, { skipMissingProperties: false, whitelist: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${details}`);
  }
  if (instance.NODE_ENV === 'production' && instance.JWT_SECRET.startsWith(DEV_SECRET_PREFIX)) {
    throw new Error(
      'Variables de entorno inválidas:\n  - JWT_SECRET: no uses el valor de ejemplo en producción',
    );
  }
  if (instance.NODE_ENV === 'production' && instance.MAIL_TRANSPORT === 'console') {
    throw new Error(
      'Variables de entorno inválidas:\n  - MAIL_TRANSPORT: "console" imprime los tokens de recuperación y no se permite en producción',
    );
  }
  if (
    instance.LOGIN_LOCK_BASE_SECONDS !== undefined &&
    instance.LOGIN_LOCK_MAX_SECONDS !== undefined &&
    instance.LOGIN_LOCK_BASE_SECONDS > instance.LOGIN_LOCK_MAX_SECONDS
  ) {
    throw new Error(
      'Variables de entorno inválidas:\n  - LOGIN_LOCK_BASE_SECONDS: no puede superar LOGIN_LOCK_MAX_SECONDS',
    );
  }
  return instance;
}
