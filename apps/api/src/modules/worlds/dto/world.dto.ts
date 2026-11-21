import { ApiProperty } from '@nestjs/swagger';

export class WorldSummaryDto {
  @ApiProperty({ example: 'arithmetic' }) slug!: string;
  @ApiProperty({ example: 'Aritmética' }) name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: 1, description: 'Orden de presentación.' }) position!: number;
  @ApiProperty({ example: 4, description: 'Número de retos de la secuencia.' }) challengeCount!: number;
}
