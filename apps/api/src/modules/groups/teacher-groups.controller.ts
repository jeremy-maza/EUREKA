import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, Roles } from '../../common';
import { UserRole } from '../../generated/prisma/client';
import {
  AddStudentDto,
  GroupDto,
  GroupMemberDto,
  GroupMemberPageDto,
  GroupPageDto,
  ListGroupsQueryDto,
  ListStudentsQueryDto,
  TeacherGroupDetailDto,
  UpdateGroupDto,
} from './dto/group.dto';
import { GroupsService } from './groups.service';
import { MembershipsService } from './memberships.service';

/**
 * Gestión de grupos por docentes. Un grupo no asignado al docente (exista o no) responde SIEMPRE 404:
 * conocer su id no da acceso ni revela su existencia.
 */
@ApiTags('teacher')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Solo docentes' })
@ApiNotFoundResponse({ description: 'Grupo inexistente o no asignado al docente' })
@Roles(UserRole.TEACHER)
@Controller('teacher/groups')
export class TeacherGroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly memberships: MembershipsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Grupos asignados al docente (paginado; por defecto solo activos)' })
  @ApiOkResponse({ type: GroupPageDto })
  list(@CurrentUser() teacher: AuthenticatedUser, @Query() query: ListGroupsQueryDto): Promise<GroupPageDto> {
    return this.groups.listForTeacher(teacher, query);
  }

  @Get(':groupId')
  @ApiOperation({ summary: 'Detalle de un grupo asignado, con sus docentes' })
  @ApiOkResponse({ type: TeacherGroupDetailDto })
  get(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<TeacherGroupDetailDto> {
    return this.groups.getForTeacher(teacher, groupId);
  }

  @Patch(':groupId')
  @ApiOperation({ summary: 'Actualiza nombre y/o descripción (el estado solo lo cambia un administrador)' })
  @ApiOkResponse({ type: GroupDto })
  @ApiConflictResponse({ description: 'El grupo está desactivado' })
  update(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateGroupDto,
  ): Promise<GroupDto> {
    return this.groups.update(teacher, groupId, dto);
  }

  @Get(':groupId/students')
  @ApiOperation({ summary: 'Estudiantes del grupo (paginado; búsqueda por nombre/correo; filtro de estado)' })
  @ApiOkResponse({ type: GroupMemberPageDto })
  listStudents(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() query: ListStudentsQueryDto,
  ): Promise<GroupMemberPageDto> {
    return this.memberships.list(teacher, groupId, query);
  }

  @Post(':groupId/students')
  @ApiOperation({ summary: 'Agrega un estudiante al grupo (por `studentId` o `email`)' })
  @ApiCreatedResponse({ type: GroupMemberDto })
  @ApiConflictResponse({ description: 'Ya pertenece al grupo o el grupo está desactivado' })
  @ApiUnprocessableEntityResponse({ description: 'El usuario no tiene rol de estudiante' })
  addStudent(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: AddStudentDto,
  ): Promise<GroupMemberDto> {
    return this.memberships.add(teacher, groupId, dto);
  }

  @Delete(':groupId/students/:studentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retira a un estudiante del grupo (queda REMOVED en el historial)' })
  @ApiNoContentResponse()
  async removeStudent(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<void> {
    await this.memberships.remove(teacher, groupId, studentId);
  }
}
