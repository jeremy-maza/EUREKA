import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CursorPageQueryDto, PageInfoDto } from '../../../common';
import { UserProfileDto } from '../../users';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Sin campo `role`: este endpoint solo crea docentes (y `forbidNonWhitelisted` rechaza cualquier extra). */
export class CreateTeacherDto {
  @ApiProperty({ example: 'profe@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Profa. Lucía' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ minLength: 8, maxLength: 128, description: 'Contraseña inicial (se guarda con scrypt).' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class ListTeachersQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Filtra por nombre o correo.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class TeacherPageDto extends PageInfoDto {
  @ApiProperty({ type: [UserProfileDto] }) items!: UserProfileDto[];
}
