import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Paginación por cursor opaco (id de la última fila devuelta). Mismo contrato que el historial de intentos. */
export class CursorPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ format: 'uuid', description: 'Cursor: `nextCursor` de la página anterior.' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

/** Forma común de las respuestas paginadas. */
export class PageInfoDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Cursor de la página siguiente; `null` si no hay más resultados.',
  })
  nextCursor!: string | null;
}

/** Recorta `limit + 1` filas pedidas a la BD en una página y su cursor. */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

/** Argumentos de Prisma para paginar por cursor con cualquier ordenación (pedir `limit + 1` filas). */
export function cursorArgs(query: { limit: number; cursor?: string }) {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  };
}
