import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CursorPageQueryDto, PageInfoDto } from '../../../common';
import { AssignmentStatus, GroupStatus, MembershipStatus } from '../../../generated/prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ───────────── Peticiones ─────────────

export class CreateGroupDto {
  @ApiProperty({ example: '5.º A — Matemáticas', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 20,
    description: 'Docentes a asignar al crear el grupo (misma transacción que la creación).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  teacherIds?: string[];
}

/** Al menos un campo. `description: null` borra la descripción. */
export class UpdateGroupDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class AssignTeacherDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teacherId!: string;
}

/** Se identifica al estudiante por `studentId` O por `email` (exactamente uno de los dos). */
export class AddStudentDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ example: 'ana@example.com' })
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export const GROUP_STATUS_FILTERS = ['ACTIVE', 'INACTIVE', 'ALL'] as const;
export type GroupStatusFilter = (typeof GROUP_STATUS_FILTERS)[number];

export class ListGroupsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({
    enum: GROUP_STATUS_FILTERS,
    description: 'Por defecto `ACTIVE` para docentes y `ALL` para administradores.',
  })
  @IsOptional()
  @IsIn(GROUP_STATUS_FILTERS)
  status?: GroupStatusFilter;
}

export class ListStudentsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Filtra por nombre o correo (contiene, sin mayúsculas).',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'REMOVED', 'ALL'],
    description: 'Por defecto `ACTIVE`. `REMOVED`/`ALL` muestran el historial de pertenencia.',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'REMOVED', 'ALL'])
  status?: MembershipStatus | 'ALL';
}

export class ListAssignmentsQueryDto {
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'REVOKED', 'ALL'],
    description: 'Por defecto `ACTIVE`. `REVOKED`/`ALL` muestran el historial de asignaciones.',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'REVOKED', 'ALL'])
  status?: AssignmentStatus | 'ALL';
}

export class ListTeacherGroupsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'REVOKED', 'ALL'],
    description: 'Estado de la ASIGNACIÓN. Por defecto `ACTIVE`.',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'REVOKED', 'ALL'])
  status?: AssignmentStatus | 'ALL';
}

// ───────────── Respuestas ─────────────

export class GroupDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: GroupStatus, enumName: 'GroupStatus' }) status!: GroupStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) deactivatedAt!: Date | null;
  @ApiProperty({ description: 'Estudiantes con membresía activa.' }) activeStudentCount!: number;
  @ApiProperty({ description: 'Docentes con asignación activa.' }) activeTeacherCount!: number;
}

export class GroupPageDto extends PageInfoDto {
  @ApiProperty({ type: [GroupDto] }) items!: GroupDto[];
}

/** Datos mínimos de una persona. */
export class PersonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}

export class PersonWithEmailDto extends PersonDto {
  @ApiProperty({ example: 'ana@example.com' }) email!: string;
}

export class TeacherAssignmentDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ type: PersonWithEmailDto }) teacher!: PersonWithEmailDto;
  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus' }) status!: AssignmentStatus;
  @ApiProperty() assignedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) revokedAt!: Date | null;
}

/** Docente visto por otro docente o por un estudiante: sin correo. */
export class GroupTeacherDto extends PersonDto {
  @ApiProperty() assignedAt!: Date;
}

export class TeacherGroupAssignmentDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus' }) status!: AssignmentStatus;
  @ApiProperty() assignedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) revokedAt!: Date | null;
  @ApiProperty({ type: GroupDto }) group!: GroupDto;
}

export class TeacherGroupAssignmentPageDto extends PageInfoDto {
  @ApiProperty({ type: [TeacherGroupAssignmentDto] }) items!: TeacherGroupAssignmentDto[];
}

export class GroupMemberDto {
  @ApiProperty({ format: 'uuid', description: 'Id de la membresía (también es el cursor de paginación).' })
  id!: string;
  @ApiProperty({ type: PersonWithEmailDto }) student!: PersonWithEmailDto;
  @ApiProperty({ enum: MembershipStatus, enumName: 'MembershipStatus' }) status!: MembershipStatus;
  @ApiProperty() joinedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) removedAt!: Date | null;
}

export class GroupMemberPageDto extends PageInfoDto {
  @ApiProperty({ type: [GroupMemberDto] }) items!: GroupMemberDto[];
}

/** Grupo visto por un docente: incluye a los docentes asignados (sin correo). */
export class TeacherGroupDetailDto extends GroupDto {
  @ApiProperty({ type: [GroupTeacherDto] }) teachers!: GroupTeacherDto[];
}

export class StudentGroupDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: GroupStatus, enumName: 'GroupStatus' }) status!: GroupStatus;
  @ApiProperty() joinedAt!: Date;
  @ApiProperty({ type: [PersonDto] }) teachers!: PersonDto[];
}
