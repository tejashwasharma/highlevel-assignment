import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateOpportunityDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  value!: number;

  @IsOptional()
  @IsIn(['open', 'won', 'lost', 'abandoned'])
  status: 'open' | 'won' | 'lost' | 'abandoned' = 'open';

  @IsString()
  @IsNotEmpty()
  owner!: string;

  @IsUUID()
  stageId!: string;
}
