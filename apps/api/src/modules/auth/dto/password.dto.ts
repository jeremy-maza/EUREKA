import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ChangePasswordDto {
  @ApiProperty({ description: 'Contraseña actual.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 128,
    description:
      'Nueva contraseña. La longitud mínima efectiva la fija `PASSWORD_MIN_LENGTH` (por defecto 8).',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ana@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recibido por correo (un solo uso).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class MessageDto {
  @ApiProperty() message!: string;
}
