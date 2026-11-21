import { Controller, Get, Param, ParseUUIDPipe, Post, Body, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common';
import { UserRole } from '../../generated/prisma/client';
import {
  ListTeacherGroupsQueryDto,
  TeacherAssignmentsService,
  TeacherGroupAssignmentPageDto,
} from '../groups';
import { UserProfileDto } from '../users';
import { CreateTeacherDto, ListTeachersQueryDto, TeacherPageDto } from './dto/admin.dto';
import { AdminTeachersService } from './admin-teachers.service';

/** Aprovisionamiento de docentes. Solo administradores: no existe registro público de docentes. */
@ApiTags('admin')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Solo administradores' })
@Roles(UserRole.ADMIN)
@Controller('admin/teachers')
export class AdminTeachersController {
  constructor(
    private readonly teachers: AdminTeachersService,
    private readonly assignments: TeacherAssignmentsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Crea una cuenta de docente' })
  @ApiCreatedResponse({ type: UserProfileDto })
  @ApiConflictResponse({ description: 'El correo ya está registrado' })
  create(@Body() dto: CreateTeacherDto): Promise<UserProfileDto> {
    return this.teachers.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista docentes (para elegir a quién asignar)' })
  @ApiOkResponse({ type: TeacherPageDto })
  list(@Query() query: ListTeachersQueryDto): Promise<TeacherPageDto> {
    return this.teachers.list(query);
  }

  @Get(':teacherId/groups')
  @ApiOperation({ summary: 'Grupos asignados a un docente (`status=ALL` incluye el historial)' })
  @ApiOkResponse({ type: TeacherGroupAssignmentPageDto })
  @ApiNotFoundResponse({ description: 'El docente no existe' })
  listGroups(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Query() query: ListTeacherGroupsQueryDto,
  ): Promise<TeacherGroupAssignmentPageDto> {
    return this.assignments.listGroupsOfTeacher(teacherId, query);
  }
}
