import { Request, Response } from 'express';
import { BulkMovesService } from './service';
import { ScopedRequest } from '../shared/workspace-scope';
import { HTTP_STATUS } from '../shared/constants/http-status';
import { CreateBulkMoveDto } from './dto/create-bulk-move.dto';

export class BulkMovesController {
  constructor(private readonly service: BulkMovesService) {}

  submitBulkMove = async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req as ScopedRequest;
    const dto = req.body as CreateBulkMoveDto;

    const job = await this.service.submitBulkMove({
      workspaceId,
      filter: dto.filter,
      targetStageId: dto.targetStageId,
    });

    res.status(HTTP_STATUS.CREATED).json(job);
  };
}
