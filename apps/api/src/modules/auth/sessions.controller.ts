import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedSessionUser, CurrentUser } from '../../common';
import { SessionRevocationReason } from '../../generated/prisma/client';
import { ListSessionsQueryDto, LogoutAllResultDto, SessionPageDto } from './dto/session.dto';
import { AuthSessionsService } from './sessions.service';

/**
 * Sesiones del PROPIO usuario autenticado. No existe ninguna variante que acepte un `userId`: ni siquiera un
 * administrador puede listar o revocar sesiones ajenas por esta API.
 */
@ApiTags('auth')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, revocado o caducado' })
@Controller('auth')
export class SessionsController {
  constructor(private readonly sessions: AuthSessionsService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'Lista mis sesiones (vigentes por defecto; `status=ALL` incluye el historial)' })
  @ApiOkResponse({ type: SessionPageDto })
  list(
    @CurrentUser() user: AuthenticatedSessionUser,
    @Query() query: ListSessionsQueryDto,
  ): Promise<SessionPageDto> {
    return this.sessions.list(user.id, query, user.sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoca una de mis sesiones (idempotente)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'La sesión no existe o no es mía' })
  async revoke(
    @CurrentUser() user: AuthenticatedSessionUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    await this.sessions.revokeOwn(user.id, sessionId, SessionRevocationReason.SESSION_REVOKED);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cierra la sesión actual (revoca su token en el servidor)' })
  @ApiNoContentResponse()
  async logout(@CurrentUser() user: AuthenticatedSessionUser): Promise<void> {
    await this.sessions.revokeOwn(user.id, user.sessionId, SessionRevocationReason.LOGOUT);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cierra TODAS mis sesiones vigentes, incluida la actual' })
  @ApiOkResponse({ type: LogoutAllResultDto })
  async logoutAll(@CurrentUser() user: AuthenticatedSessionUser): Promise<LogoutAllResultDto> {
    return { revokedSessions: await this.sessions.revokeAll(user.id, SessionRevocationReason.LOGOUT_ALL) };
  }
}
