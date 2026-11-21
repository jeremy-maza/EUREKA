import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService } from './health.service';

class LivenessResponse {
  @ApiProperty({ example: 'ok' }) status!: 'ok';
  @ApiProperty({ example: '2026-11-21T10:00:00.000Z' }) timestamp!: string;
  @ApiProperty({ example: 120 }) uptimeSeconds!: number;
}

class ReadinessResponse {
  @ApiProperty({ example: 'ok' }) status!: 'ok';
  @ApiProperty({ example: 'up' }) database!: 'up';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness: el proceso responde' })
  @ApiOkResponse({ type: LivenessResponse })
  liveness(): LivenessResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: el proceso puede atender tráfico (base de datos accesible)' })
  @ApiOkResponse({ type: ReadinessResponse })
  @ApiServiceUnavailableResponse({ description: 'La base de datos no responde' })
  async readiness(): Promise<ReadinessResponse> {
    if (!(await this.health.isDatabaseUp())) {
      throw new ServiceUnavailableException('La base de datos no está disponible.');
    }
    return { status: 'ok', database: 'up' };
  }
}
