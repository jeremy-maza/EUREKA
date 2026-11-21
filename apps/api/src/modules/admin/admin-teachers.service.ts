import { Injectable } from '@nestjs/common';
import { cursorArgs, toPage } from '../../common';
import { UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordHasher } from '../auth/password-hasher';
import { PasswordPolicy } from '../auth/password-policy';
import { UserProfileDto, UsersService } from '../users';
import { CreateTeacherDto, ListTeachersQueryDto, TeacherPageDto } from './dto/admin.dto';
import { provisionUser } from './provisioning';

@Injectable()
export class AdminTeachersService {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * El rol lo fija el servidor (TEACHER); el cliente no puede elegirlo. La contraseña es TEMPORAL: el docente la
   * sustituye con `POST /auth/change-password` en su primer acceso (o usa la recuperación por correo).
   */
  create(dto: CreateTeacherDto): Promise<UserProfileDto> {
    this.policy.assert(dto.password, { email: dto.email });
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
