import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';


export class ListOpportunitiesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
