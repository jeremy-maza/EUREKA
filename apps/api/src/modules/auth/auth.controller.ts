import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../../common';
import { UserProfileDto } from '../users';
import { AuthService } from './auth.service';
import { AccessTokenDto, LoginDto, RegisterDto } from './dto/auth.dto';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Registra un estudiante' })
  @ApiCreatedResponse({ type: UserProfileDto })
  @ApiConflictResponse({ description: 'El correo ya está registrado' })
  register(@Body() dto: RegisterDto): Promise<UserProfileDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia sesión: crea una sesión revocable y devuelve su token de acceso JWT' })
  @ApiOkResponse({ type: AccessTokenDto })
  @ApiUnauthorizedResponse({ description: 'Credenciales inválidas (misma respuesta si la cuenta no existe)' })
  @ApiTooManyRequestsResponse({ description: 'Demasiados intentos; cabecera `Retry-After` en segundos' })
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AccessTokenDto> {
    return this.auth.login(dto, { ip, userAgent });
  }
}
