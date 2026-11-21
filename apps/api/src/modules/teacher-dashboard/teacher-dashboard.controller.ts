import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, Roles } from '../../common';
import { UserRole } from '../../generated/prisma/client';
import { ListStudentsQueryDto } from '../groups';
import {
  GroupDashboardDto,
  GroupStatisticsDto,
  StatisticsQueryDto,
  StudentAttemptPageDto,
  StudentAttemptsQueryDto,
  StudentOverviewDto,
  StudentOverviewPageDto,
  StudentStatisticsDto,
  TeacherDashboardDto,
} from './dto/dashboard.dto';
import { TeacherDashboardService } from './teacher-dashboard.service';

/**
 * API del panel docente (solo datos; no hay vistas). Todo está acotado a los grupos asignados al docente y a
 * los estudiantes con membresía activa en ellos. Un grupo ajeno o un estudiante fuera del grupo responde 404.
 */
@ApiTags('teacher-dashboard')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Solo docentes' })
@Roles(UserRole.TEACHER)
@Controller('teacher')
export class TeacherDashboardController {
  constructor(private readonly dashboard: TeacherDashboardService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Resumen de los grupos activos del docente: estudiantes y actividad' })
  @ApiOkResponse({ type: TeacherDashboardDto })
  overview(@CurrentUser() teacher: AuthenticatedUser): Promise<TeacherDashboardDto> {
    return this.dashboard.overview(teacher);
  }

  @Get('groups/:groupId/dashboard')
  @ApiOperation({ summary: 'Resumen de un grupo: actividad y rendimiento por mundo' })
  @ApiOkResponse({ type: GroupDashboardDto })
  @ApiNotFoundResponse({ description: 'Grupo inexistente o no asignado al docente' })
  groupDashboard(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<GroupDashboardDto> {
    return this.dashboard.groupDashboard(teacher, groupId);
  }

  @Get('groups/:groupId/dashboard/students')
  @ApiOperation({
    summary: 'Resumen de cada estudiante del grupo (puntos, aciertos, precisión, rachas, progreso por mundo)',
  })
  @ApiOkResponse({ type: StudentOverviewPageDto })
  @ApiNotFoundResponse({ description: 'Grupo inexistente o no asignado al docente' })
  groupStudents(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() query: ListStudentsQueryDto,
  ): Promise<StudentOverviewPageDto> {
    return this.dashboard.groupStudents(teacher, groupId, query);
  }

  @Get('groups/:groupId/statistics')
  @ApiOperation({
    summary:
      'Rendimiento de aprendizaje: errores comunes, reglas incumplidas, retos a reforzar y estudiantes en riesgo',
  })
  @ApiOkResponse({ type: GroupStatisticsDto })
  @ApiNotFoundResponse({ description: 'Grupo inexistente o no asignado al docente' })
  groupStatistics(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() query: StatisticsQueryDto,
  ): Promise<GroupStatisticsDto> {
    return this.dashboard.groupStatistics(teacher, groupId, query);
  }

  @Get('groups/:groupId/students/:studentId')
  @ApiOperation({ summary: 'Resumen de un estudiante del grupo' })
  @ApiOkResponse({ type: StudentOverviewDto })
  @ApiNotFoundResponse({ description: 'Grupo no asignado o estudiante fuera del grupo' })
  student(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<StudentOverviewDto> {
    return this.dashboard.studentOverviewInGroup(teacher, groupId, studentId);
  }

  @Get('groups/:groupId/students/:studentId/statistics')
  @ApiOperation({ summary: 'Estadísticas de aprendizaje de un estudiante, por mundo' })
  @ApiOkResponse({ type: StudentStatisticsDto })
  @ApiNotFoundResponse({ description: 'Grupo no asignado o estudiante fuera del grupo' })
  studentStatistics(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<StudentStatisticsDto> {
    return this.dashboard.studentStatistics(teacher, groupId, studentId);
  }

  @Get('groups/:groupId/students/:studentId/attempts')
  @ApiOperation({ summary: 'Historial de intentos resueltos de un estudiante (cursor; filtro por mundo)' })
  @ApiOkResponse({ type: StudentAttemptPageDto })
  @ApiNotFoundResponse({ description: 'Grupo no asignado o estudiante fuera del grupo' })
  studentAttempts(
    @CurrentUser() teacher: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: StudentAttemptsQueryDto,
  ): Promise<StudentAttemptPageDto> {
    return this.dashboard.studentAttempts(teacher, groupId, studentId, query);
  }
}
