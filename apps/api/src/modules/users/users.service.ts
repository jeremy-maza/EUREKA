import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, User, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileDto } from './dto/user.dto';

export interface CreateUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
  role?: UserRole;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  /** @throws ConflictException si el email ya está registrado. */
  async create(input: CreateUserInput): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: normalizeEmail(input.email),
          displayName: input.displayName.trim(),
          passwordHash: input.passwordHash,
          role: input.role ?? UserRole.STUDENT,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe una cuenta con ese correo.');
      }
      throw error;
    }
  }

  /** Proyección pública: nunca expone `passwordHash` ni el modelo de BD. */
  toProfile(user: User): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
