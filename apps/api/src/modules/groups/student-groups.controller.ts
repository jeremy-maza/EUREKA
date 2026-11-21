import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, Roles } from '../../common';
import { UserRole } from '../../generated/prisma/client';
import { StudentGroupDto } from './dto/group.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Solo estudiantes' })
@Roles(UserRole.STUDENT)
@Controller('users/me/groups')
export class StudentGroupsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @ApiOperation({ summary: 'Grupos a los que pertenece el estudiante autenticado, con sus docentes' })
  @ApiOkResponse({ type: [StudentGroupDto] })
  list(@CurrentUser() student: AuthenticatedUser): Promise<StudentGroupDto[]> {
    return this.memberships.listForStudent(student.id);
  }
}
