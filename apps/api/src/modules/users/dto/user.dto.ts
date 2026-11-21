import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../generated/prisma/client';

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'ana@example.com' }) email!: string;
  @ApiProperty({ example: 'Ana' }) displayName!: string;
  @ApiProperty({ enum: UserRole, enumName: 'UserRole' }) role!: UserRole;
  @ApiProperty() createdAt!: Date;
}
