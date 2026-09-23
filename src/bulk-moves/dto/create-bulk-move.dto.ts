import { IsDefined, IsObject, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BulkMoveFilterDto } from './bulk-move-filter.dto';

export class CreateBulkMoveDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BulkMoveFilterDto)
  filter!: BulkMoveFilterDto;

  @IsUUID()
  targetStageId!: string;
}
