import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserProfileDto, UsersService } from '../users';
import { AccessTokenDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  /** Hash ficticio para igualar el coste de login cuando el correo no existe (evita enumeración por tiempo). */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  /** El autorregistro SIEMPRE crea estudiantes; los docentes los crea un administrador (pendiente). */
  async register(dto: RegisterDto): Promise<UserProfileDto> {
    const passwordHash = await this.hasher.hash(dto.password);
    const user = await this.users.create({ email: dto.email, displayName: dto.displayName, passwordHash });
    return this.users.toProfile(user);
  }

  async login(dto: LoginDto): Promise<AccessTokenDto> {
    const user = await this.users.findByEmail(dto.email);
    const stored = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await this.hasher.verify(dto.password, stored);
    if (!user || !valid) throw new UnauthorizedException('Credenciales inválidas.');

    const { accessToken, expiresIn } = this.tokens.issue({ sub: user.id, role: user.role });
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('dummy-password-for-timing');
    return this.dummyHash;
  }
}
