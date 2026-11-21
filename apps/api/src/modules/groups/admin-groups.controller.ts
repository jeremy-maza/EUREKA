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
  AssignTeacherDto,
  CreateGroupDto,
  GroupDto,
  GroupMemberDto,
  GroupMemberPageDto,
  GroupPageDto,
  ListAssignmentsQueryDto,
  ListGroupsQueryDto,
  ListStudentsQueryDto,
  TeacherAssignmentDto,
  UpdateGroupDto,
} from './dto/group.dto';
import { GroupsService } from './groups.service';
import { MembershipsService } from './memberships.service';
import { TeacherAssignmentsService } from './teacher-assignments.service';

/** Gestión administrativa de grupos, asignaciones docentes y membresías. Solo `ADMIN`. */
@ApiTags('admin')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Solo administradores' })
@Roles(UserRole.ADMIN)
@Controller('admin/groups')
export class AdminGroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly assignments: TeacherAssignmentsService,
    private readonly memberships: MembershipsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Crea un grupo (opcionalmente con sus docentes, en una transacción)' })
  @ApiCreatedResponse({ type: GroupDto })
  create(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreateGroupDto): Promise<GroupDto> {
    return this.groups.create(admin, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista todos los grupos (paginado por cursor; filtro por estado)' })
  @ApiOkResponse({ type: GroupPageDto })
  list(@Query() query: ListGroupsQueryDto): Promise<GroupPageDto> {
    return this.groups.listAll(query);
  }

  @Get(':groupId')
  @ApiOperation({ summary: 'Detalle de un grupo' })
  @ApiOkResponse({ type: GroupDto })
  @ApiNotFoundResponse({ description: 'El grupo no existe' })
  get(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<GroupDto> {
    return this.groups.get(admin, groupId);
  }

  @Patch(':groupId')
  @ApiOperation({ summary: 'Actualiza nombre y/o descripción' })
  @ApiOkResponse({ type: GroupDto })
  @ApiConflictResponse({ description: 'El grupo está desactivado' })
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateGroupDto,
  ): Promise<GroupDto> {
    return this.groups.update(admin, groupId, dto);
  }

  @Post(':groupId/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desactiva el grupo (no se borra; queda de solo lectura y conserva todo el historial)',
  })
  @ApiOkResponse({ type: GroupDto })
  @ApiConflictResponse({ description: 'Ya estaba desactivado' })
  deactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<GroupDto> {
    return this.groups.deactivate(admin, groupId);
  }

  @Post(':groupId/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactiva un grupo desactivado' })
  @ApiOkResponse({ type: GroupDto })
  @ApiConflictResponse({ description: 'Ya estaba activo' })
  reactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<GroupDto> {
    return this.groups.reactivate(admin, groupId);
  }

  // ───────────── Docentes asignados ─────────────

  @Get(':groupId/teachers')
  @ApiOperation({ summary: 'Docentes del grupo (`status=ALL` incluye el historial de asignaciones)' })
  @ApiOkResponse({ type: [TeacherAssignmentDto] })
  listTeachers(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() query: ListAssignmentsQueryDto,
  ): Promise<TeacherAssignmentDto[]> {
    return this.assignments.listForGroup(admin, groupId, query);
  }

  @Post(':groupId/teachers')
  @ApiOperation({ summary: 'Asigna un docente al grupo' })
  @ApiCreatedResponse({ type: TeacherAssignmentDto })
  @ApiNotFoundResponse({ description: 'Grupo o docente inexistente' })
  @ApiConflictResponse({ description: 'Ya está asignado o el grupo está desactivado' })
  @ApiUnprocessableEntityResponse({ description: 'El usuario no tiene rol de docente' })
  assignTeacher(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: AssignTeacherDto,
  ): Promise<TeacherAssignmentDto> {
    return this.assignments.assign(admin, groupId, dto.teacherId);
  }

  @Delete(':groupId/teachers/:teacherId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retira la asignación del docente (queda REVOKED en el historial)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'No existe una asignación activa' })
  async revokeTeacher(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
  ): Promise<void> {
    await this.assignments.revoke(admin, groupId, teacherId);
  }

  // ───────────── Estudiantes (para grupos sin docente o correcciones) ─────────────

  @Get(':groupId/students')
  @ApiOperation({ summary: 'Estudiantes del grupo (paginado; búsqueda y filtro de estado)' })
  @ApiOkResponse({ type: GroupMemberPageDto })
  listStudents(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() query: ListStudentsQueryDto,
  ): Promise<GroupMemberPageDto> {
    return this.memberships.list(admin, groupId, query);
  }

  @Post(':groupId/students')
  @ApiOperation({ summary: 'Agrega un estudiante (por `studentId` o `email`)' })
  @ApiCreatedResponse({ type: GroupMemberDto })
  @ApiConflictResponse({ description: 'Ya pertenece al grupo o el grupo está desactivado' })
  @ApiUnprocessableEntityResponse({ description: 'El usuario no tiene rol de estudiante' })
  addStudent(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: AddStudentDto,
  ): Promise<GroupMemberDto> {
    return this.memberships.add(admin, groupId, dto);
  }

  @Delete(':groupId/students/:studentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retira a un estudiante (queda REMOVED en el historial)' })
  @ApiNoContentResponse()
  async removeStudent(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<void> {
    await this.memberships.remove(admin, groupId, studentId);
  }
}
