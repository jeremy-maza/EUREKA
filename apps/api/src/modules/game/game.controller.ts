import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthenticatedUser, CurrentUser, Roles } from '../../common';
import { UserRole } from '../../generated/prisma/client';
import {
  AnswerResultDto,
  ChallengeAttemptDto,
  SessionDto,
  StartSessionResponseDto,
  SubmitAnswerDto,
} from './dto/game.dto';
import { GameService } from './game.service';

/** Flujo de juego del estudiante. Toda transición de estado y todo cálculo ocurren en el servidor. */
@ApiTags('game')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Solo los estudiantes pueden jugar' })
@Roles(UserRole.STUDENT)
@Controller()
export class GameController {
  constructor(private readonly game: GameService) {}

  @Post('worlds/:slug/sessions')
  @ApiOperation({
    summary: 'Inicia una sesión de juego en un mundo (o reanuda la abierta)',
    description: 'No borra reglas ni progreso. 201 si se creó; 200 si se reanudó la sesión abierta.',
  })
  @ApiCreatedResponse({ type: StartSessionResponseDto })
  @ApiOkResponse({ type: StartSessionResponseDto, description: 'Se reanudó la sesión abierta' })
  @ApiNotFoundResponse({ description: 'El mundo no existe' })
  async startSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StartSessionResponseDto> {
    const result = await this.game.startSession(user.id, slug);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Post('sessions/:sessionId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Termina la sesión (no permitido con un reto en curso)' })
  @ApiOkResponse({ type: SessionDto })
  @ApiConflictResponse({ description: 'Hay un reto en curso' })
  endSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<SessionDto> {
    return this.game.endSession(user.id, sessionId);
  }

  @Post('sessions/:sessionId/attempts')
  @ApiOperation({
    summary: 'Inicia el reto actual (arranca el cronómetro del servidor) o devuelve el intento abierto',
    description:
      'Un solo intento por reto. Si el intento abierto había vencido se cierra como TIMEOUT (la secuencia se reinicia, las reglas se conservan) y se inicia uno nuevo. 201 si se creó; 200 si se reanudó.',
  })
  @ApiCreatedResponse({ type: ChallengeAttemptDto })
  @ApiOkResponse({ type: ChallengeAttemptDto, description: 'Se devolvió el intento ya abierto' })
  @ApiConflictResponse({ description: 'La sesión terminó o el mundo está completado' })
  async startAttempt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChallengeAttemptDto> {
    const attempt = await this.game.startAttempt(user.id, sessionId);
    res.status(attempt.resumed ? HttpStatus.OK : HttpStatus.CREATED);
    return attempt;
  }

  @Get('sessions/:sessionId/attempts/current')
  @ApiOperation({ summary: 'Reto en curso de la sesión' })
  @ApiOkResponse({ type: ChallengeAttemptDto })
  @ApiNotFoundResponse({ description: 'No hay un reto en curso' })
  async currentAttempt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<ChallengeAttemptDto> {
    const attempt = await this.game.getCurrentAttempt(user.id, sessionId);
    if (!attempt)
      throw new NotFoundException('No hay un reto en curso; inicia uno con POST /sessions/{id}/attempts.');
    return attempt;
  }

  @Post('attempts/:attemptId/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envía la expresión del reto',
    description:
      'Única entrada del cliente: la expresión. El servidor mide el tiempo, valida resultado y reglas, puntúa y actualiza progreso en una transacción. Un fallo o timeout termina el reto y reinicia la secuencia. Reenviar la misma respuesta es idempotente.',
  })
  @ApiOkResponse({ type: AnswerResultDto })
  @ApiNotFoundResponse({ description: 'Intento inexistente o de otro usuario' })
  @ApiConflictResponse({ description: 'El reto ya se resolvió con otra respuesta' })
  submitAnswer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() dto: SubmitAnswerDto,
  ): Promise<AnswerResultDto> {
    return this.game.submitAnswer(user.id, attemptId, dto.expression);
  }
}
