import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
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

  // Reservadas para el módulo `auth` (aún no implementado).
  @IsOptional()
  @IsString()
  @MinLength(32)
  JWT_SECRET?: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;
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
  return instance;
}
