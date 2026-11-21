import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { TooManyRequestsException } from '../../common';
import { AUTH_CONFIG } from '../../config/auth.config';
import type { AuthConfig } from '../../config/auth.config';
import { ThrottleScope } from '../../generated/prisma/client';
import { UserProfileDto, UsersService } from '../users';
import { AccessTokenDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy';
import { AuthSessionsService } from './sessions.service';
import type { SessionClientMeta } from './sessions.service';
import { ThrottleService, ThrottleTarget } from './throttle.service';
import { loginThrottleTargets } from './throttle-keys';

const INVALID_CREDENTIALS = 'Credenciales inválidas.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Hash ficticio para igualar el coste de login cuando el correo no existe (evita enumeración por tiempo). */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: AuthSessionsService,
    private readonly throttle: ThrottleService,
    private readonly policy: PasswordPolicy,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** El autorregistro SIEMPRE crea estudiantes; los docentes los crea un administrador (`POST /admin/teachers`). */
  async register(dto: RegisterDto): Promise<UserProfileDto> {
    this.policy.assert(dto.password, { email: dto.email });
    const passwordHash = await this.hasher.hash(dto.password);
    const user = await this.users.create({ email: dto.email, displayName: dto.displayName, passwordHash });
    return this.users.toProfile(user);
  }

  /**
   * Login con límite de intentos. El intento se cuenta ANTES de verificar la contraseña (bajo bloqueo de fila), así que las
   * peticiones concurrentes no pueden superar el límite. Un bloqueo, exista o no la cuenta, responde igual (429).
   * Cuenta inexistente y contraseña errónea responden igual (401) y cuestan lo mismo (hash ficticio).
   */
  async login(dto: LoginDto, meta: SessionClientMeta = {}): Promise<AccessTokenDto> {
    const targets = loginThrottleTargets(this.config.login, meta.ip, dto.email);
    const verdict = await this.throttle.charge(targets);
    if (!verdict.allowed) throw new TooManyRequestsException(verdict.retryAfterSeconds);

    const user = await this.users.findByEmail(dto.email);
    const stored = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await this.hasher.verify(dto.password, stored);
    if (!user || !valid) throw new UnauthorizedException(INVALID_CREDENTIALS);

    const session = await this.sessions.issue(user, meta);
    // La contraseña cambió entre la verificación y la emisión: el intento no vale.
    if (!session) throw new UnauthorizedException(INVALID_CREDENTIALS);

    await this.refundSuccessfulLogin(targets);
    return { accessToken: session.accessToken, tokenType: 'Bearer', expiresIn: session.expiresIn };
  }

  /**
   * Tras un éxito: el contador del par IP+correo se borra y el intento se devuelve a los contadores por IP y por correo.
   * El contador por correo NO se pone a cero: un atacante distribuido contra una cuenta no debe recuperar su presupuesto
   * porque el dueño inicie sesión. Un fallo aquí no debe tumbar un login ya válido.
   */
  private async refundSuccessfulLogin(targets: ThrottleTarget[]): Promise<void> {
    try {
      for (const { scope, key } of targets) {
        if (scope === ThrottleScope.LOGIN_IP_EMAIL) await this.throttle.clear(scope, key);
        else await this.throttle.release(scope, key);
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo actualizar el limitador tras un login correcto: ${(error as Error).message}`,
      );
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('dummy-password-for-timing');
    return this.dummyHash;
  }
}
