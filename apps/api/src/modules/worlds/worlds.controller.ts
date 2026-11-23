import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorldSummaryDto } from './dto/world.dto';
import { WorldDefinition } from './world.types';
import { WorldsRepository } from './worlds.repository';

export function toWorldSummaryDto(definition: WorldDefinition): WorldSummaryDto {
  return {
    slug: definition.slug,
    name: definition.name,
    description: definition.description,
    position: definition.position,
    challengeCount: definition.sequence.ruleCount.BASELINE + 1,
    ruleCount: definition.rules.length,
    concepts: [...definition.concepts],
    syntax: { decimals: definition.syntax.decimals, powers: definition.syntax.powers },
  };
}

@ApiTags('worlds')
@ApiBearerAuth()
@Controller('worlds')
export class WorldsController {
  constructor(private readonly worlds: WorldsRepository) {}

  @Get()
  @ApiOperation({
    summary: 'Mundos disponibles',
    description: 'El desbloqueo por jugador está en GET /progress.',
  })
  @ApiOkResponse({ type: [WorldSummaryDto] })
  async list(): Promise<WorldSummaryDto[]> {
    const worlds = await this.worlds.listEnabled();
    return worlds.map(({ definition }) => toWorldSummaryDto(definition));
  }
}
