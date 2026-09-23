import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkMoveFilterDto {
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsIn(['open', 'won', 'lost', 'abandoned'])
  status?: 'open' | 'won' | 'lost' | 'abandoned';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueMax?: number;

  @IsOptional()
  @IsISO8601()
  createdAfter?: string;

  @IsOptional()
  @IsISO8601()
  createdBefore?: string;
}
