import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedSessionUser, CurrentUser, Public } from '../../common';
import { ChangePasswordDto, ForgotPasswordDto, MessageDto, ResetPasswordDto } from './dto/password.dto';
import { PasswordService } from './password.service';

/** Mismo texto siempre: no revela si el correo está registrado. */
export const FORGOT_PASSWORD_RESPONSE =
  'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.';

/** Cambio (autenticado) y recuperación (público) de contraseña. El guard global sigue denegando por defecto. */
@ApiTags('auth')
@Controller('auth')
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambia la contraseña propia (estudiantes, docentes y administradores)',
    description:
      'Exige la contraseña actual. Al terminar se revocan TODAS las sesiones del usuario, incluida la actual: ' +
      'hay que volver a iniciar sesión con `POST /auth/login`.',
  })
  @ApiOkResponse({ type: MessageDto })
  @ApiBadRequestResponse({ description: 'Nueva contraseña inválida según la política, o igual a la actual' })
  @ApiUnauthorizedResponse({ description: 'Token ausente, revocado o caducado' })
  @ApiForbiddenResponse({ description: 'La contraseña actual es incorrecta' })
  @ApiConflictResponse({ description: 'La contraseña cambió simultáneamente; reintenta' })
  @ApiTooManyRequestsResponse({
    description: 'Demasiados intentos con la contraseña actual (cabecera `Retry-After`)',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedSessionUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageDto> {
    await this.passwords.changePassword(user, dto);
    return { message: 'Contraseña actualizada. Inicia sesión de nuevo.' };
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Solicita un correo de recuperación de contraseña',
    description:
      'Responde SIEMPRE lo mismo (202), exista o no una cuenta con ese correo. Un nuevo token invalida el anterior.',
  })
  @ApiAcceptedResponse({ type: MessageDto })
  @ApiTooManyRequestsResponse({
    description: 'Demasiadas solicitudes desde esta IP (cabecera `Retry-After`)',
  })
  async forgot(@Body() dto: ForgotPasswordDto, @Ip() ip: string): Promise<MessageDto> {
    await this.passwords.requestReset(dto.email, ip);
    return { message: FORGOT_PASSWORD_RESPONSE };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restablece la contraseña con el token recibido por correo',
    description: 'El token es de un solo uso. Revoca todas las sesiones del usuario; no inicia sesión.',
  })
  @ApiOkResponse({ type: MessageDto })
  @ApiBadRequestResponse({
    description: 'Token inválido, caducado o ya usado; o contraseña que incumple la política',
  })
  async reset(@Body() dto: ResetPasswordDto, @Ip() ip: string): Promise<MessageDto> {
    await this.passwords.resetPassword(dto, ip);
    return { message: 'Contraseña restablecida. Inicia sesión con la nueva contraseña.' };
  }
}
