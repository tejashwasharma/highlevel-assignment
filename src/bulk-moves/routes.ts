import { Router } from 'express';
import { BulkMovesController } from './controller';
import { validateDto } from '../shared/validate';
import { workspaceScope } from '../shared/workspace-scope';
import { CreateBulkMoveDto } from './dto/create-bulk-move.dto';

export function bulkMovesRouter(controller: BulkMovesController): Router {
  const router = Router();

  router.post(
    '/bulk-moves',
    workspaceScope,
    validateDto(CreateBulkMoveDto),
    controller.submitBulkMove,
  );
  router.get(
    '/bulk-moves/:id',
    workspaceScope,
    controller.getBulkMoveProgress
  );

  return router;
}
