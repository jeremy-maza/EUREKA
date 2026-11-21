import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { GroupsModule } from '../groups';
import { UsersModule } from '../users';
import { AdminTeachersController } from './admin-teachers.controller';
import { AdminTeachersService } from './admin-teachers.service';

@Module({
  imports: [AuthModule, GroupsModule, UsersModule],
  controllers: [AdminTeachersController],
  providers: [AdminTeachersService],
})
export class AdminModule {}
