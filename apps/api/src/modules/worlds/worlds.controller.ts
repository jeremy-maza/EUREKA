import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorldSummaryDto } from './dto/world.dto';
import { WorldsRepository } from './worlds.repository';

@ApiTags('worlds')
@ApiBearerAuth()
@Controller('worlds')
export class WorldsController {
  constructor(private readonly worlds: WorldsRepository) {}

  @Get()
  @ApiOperation({ summary: 'Mundos disponibles' })
  @ApiOkResponse({ type: [WorldSummaryDto] })
  async list(): Promise<WorldSummaryDto[]> {
    const worlds = await this.worlds.listEnabled();
    return worlds.map(({ definition }) => ({
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      position: definition.position,
      challengeCount: definition.challenges.length,
    }));
  }
}
