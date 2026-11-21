import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups';
import { ProgressionModule } from '../progression';
import { StatisticsModule } from '../statistics';
import { WorldsModule } from '../worlds';
import { TeacherDashboardController } from './teacher-dashboard.controller';
import { TeacherDashboardService } from './teacher-dashboard.service';

@Module({
  imports: [GroupsModule, ProgressionModule, StatisticsModule, WorldsModule],
  controllers: [TeacherDashboardController],
  providers: [TeacherDashboardService],
})
export class TeacherDashboardModule {}
