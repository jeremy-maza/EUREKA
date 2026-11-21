import { Injectable } from '@nestjs/common';
import { cursorArgs, toPage } from '../../common';
import { UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordHasher } from '../auth/password-hasher';
import { UserProfileDto, UsersService } from '../users';
import { CreateTeacherDto, ListTeachersQueryDto, TeacherPageDto } from './dto/admin.dto';
import { provisionUser } from './provisioning';

@Injectable()
export class AdminTeachersService {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly prisma: PrismaService,
  ) {}

  /** El rol lo fija el servidor (TEACHER); el cliente no puede elegirlo. */
  create(dto: CreateTeacherDto): Promise<UserProfileDto> {
    return provisionUser(this.users, this.hasher, { ...dto, role: UserRole.TEACHER });
  }

  async list(query: ListTeachersQueryDto): Promise<TeacherPageDto> {
    const rows = await this.prisma.user.findMany({
      where: {
        role: UserRole.TEACHER,
        ...(query.search
          ? {
              OR: [
                { displayName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      ...cursorArgs(query),
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map((row) => this.users.toProfile(row)), nextCursor: page.nextCursor };
  }
}
