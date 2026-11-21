import { Module } from '@nestjs/common';
import { AdminGroupsController } from './admin-groups.controller';
import { GroupAccessService } from './group-access.service';
import { GroupsService } from './groups.service';
import { MembershipsService } from './memberships.service';
import { StudentGroupsController } from './student-groups.controller';
import { TeacherAssignmentsService } from './teacher-assignments.service';
import { TeacherGroupsController } from './teacher-groups.controller';

@Module({
  controllers: [AdminGroupsController, TeacherGroupsController, StudentGroupsController],
  providers: [GroupAccessService, GroupsService, TeacherAssignmentsService, MembershipsService],
  exports: [GroupAccessService, MembershipsService, TeacherAssignmentsService],
})
export class GroupsModule {}
