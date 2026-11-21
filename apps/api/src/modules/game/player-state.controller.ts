import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, Roles } from '../../common';
import { UserRole } from '../../generated/prisma/client';
import {
  AttemptHistoryPageDto,
  PageQueryDto,
  RecentQueryDto,
  ScoreSummaryDto,
  UnlockedRuleDto,
  WorldProgressDto,
} from './dto/game.dto';
import { PlayerStateService } from './player-state.service';

/** Estado del propio jugador. Un docente no accede aquí; su vista (por grupos asignados) será otro módulo. */
@ApiTags('player')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Solo los estudiantes tienen estado de juego' })
@Roles(UserRole.STUDENT)
@Controller()
export class PlayerStateController {
  constructor(private readonly state: PlayerStateService) {}

  @Get('progress')
  @ApiOperation({
    summary: 'Progreso y rachas del jugador en todos los mundos (la racha es independiente por mundo)',
  })
  @ApiOkResponse({ type: [WorldProgressDto] })
  listProgress(@CurrentUser() user: AuthenticatedUser): Promise<WorldProgressDto[]> {
    return this.state.listProgress(user.id);
  }

  @Get('worlds/:slug/progress')
  @ApiOperation({ summary: 'Progreso del jugador en un mundo' })
  @ApiOkResponse({ type: WorldProgressDto })
  @ApiNotFoundResponse({ description: 'El mundo no existe' })
  getProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
  ): Promise<WorldProgressDto> {
    return this.state.getProgress(user.id, slug);
  }

  @Get('worlds/:slug/rules')
  @ApiOperation({ summary: 'Reglas acumuladas del jugador en el mundo' })
  @ApiOkResponse({ type: [UnlockedRuleDto] })
  getRules(@CurrentUser() user: AuthenticatedUser, @Param('slug') slug: string): Promise<UnlockedRuleDto[]> {
    return this.state.getUnlockedRules(user.id, slug);
  }

  @Get('worlds/:slug/score')
  @ApiOperation({ summary: 'Puntuación del jugador en el mundo (total, racha y libro de puntos reciente)' })
  @ApiOkResponse({ type: ScoreSummaryDto })
  getScore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: RecentQueryDto,
  ): Promise<ScoreSummaryDto> {
    return this.state.getScore(user.id, slug, query.limit);
  }

  @Get('worlds/:slug/attempts')
  @ApiOperation({ summary: 'Historial de intentos (incluye fallos y timeouts), paginado por cursor' })
  @ApiOkResponse({ type: AttemptHistoryPageDto })
  getAttempts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query() query: PageQueryDto,
  ): Promise<AttemptHistoryPageDto> {
    return this.state.getAttemptHistory(user.id, slug, query.limit, query.cursor);
  }
}
