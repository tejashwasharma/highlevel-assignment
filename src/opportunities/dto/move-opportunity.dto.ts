import { IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

export class MoveOpportunityDto {
  @IsUUID()
  toStageId!: string;

  @IsInt()
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  movedBy?: string;
}
