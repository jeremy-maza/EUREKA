import { ApiProperty } from '@nestjs/swagger';

export class MathSyntaxDto {
  @ApiProperty({ description: 'Se admiten números decimales (2.5).' }) decimals!: boolean;
  @ApiProperty({ description: 'Se admiten potencias (2 ^ 3).' }) powers!: boolean;
}

export class WorldSummaryDto {
  @ApiProperty({ example: 'arithmetic' }) slug!: string;
  @ApiProperty({ example: 'Aritmética' }) name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: 1, description: 'Orden de presentación y de desbloqueo.' }) position!: number;
  @ApiProperty({
    example: 4,
    description:
      'Retos de una secuencia de dificultad normal (reglas sorteadas + 1). Varía con la dificultad.',
  })
  challengeCount!: number;
  @ApiProperty({
    example: 6,
    description: 'Reglas del repertorio del mundo (cada secuencia sortea algunas).',
  })
  ruleCount!: number;
  @ApiProperty({ type: [String], example: ['Las cuatro operaciones', 'Jerarquía de operaciones'] })
  concepts!: string[];
  @ApiProperty({ type: MathSyntaxDto }) syntax!: MathSyntaxDto;
}
