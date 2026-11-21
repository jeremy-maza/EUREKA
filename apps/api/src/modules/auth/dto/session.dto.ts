import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CursorPageQueryDto, PageInfoDto } from '../../../common';
import { SessionRevocationReason } from '../../../generated/prisma/client';

export const SESSION_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export class SessionDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Id de la sesión (claim `jti` del token). Úsalo en `DELETE /auth/sessions/:id`.',
  })
  id!: string;

  @ApiProperty({ enum: SESSION_STATUSES })
  status!: SessionStatus;

  @ApiProperty({ description: 'Es la sesión con la que se hizo esta petición.' })
  current!: boolean;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() expiresAt!: Date;

  @ApiProperty({ nullable: true, type: Date }) revokedAt!: Date | null;

  @ApiProperty({ enum: SessionRevocationReason, enumName: 'SessionRevocationReason', nullable: true })
  revocationReason!: SessionRevocationReason | null;

  @ApiProperty({ nullable: true, type: String, description: 'IP desde la que se inició sesión.' })
  ipAddress!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'User-Agent (truncado) para reconocer el dispositivo.',
  })
  userAgent!: string | null;
}

export class SessionPageDto extends PageInfoDto {
  @ApiProperty({ type: [SessionDto] })
  items!: SessionDto[];
}

export class ListSessionsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'ALL'],
    default: 'ACTIVE',
    description: '`ACTIVE`: solo sesiones vigentes. `ALL`: incluye revocadas y caducadas (historial).',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'ALL'])
  status: 'ACTIVE' | 'ALL' = 'ACTIVE';
}

export class LogoutAllResultDto {
  @ApiProperty({ description: 'Sesiones vigentes que se han revocado (incluida la actual).' })
  revokedSessions!: number;
}
