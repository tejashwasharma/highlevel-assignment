import { BulkMoveJob, BulkMoveJobRow, BulkMoveFilterInput } from './types';
import { Database } from '../db/database';
import { NotFoundError } from '../shared/errors';
import { ERROR_CODES } from '../shared/constants/error-codes';

const MAX_SNAPSHOT_ITEMS = 50000;

export class BulkMovesRepository {
  constructor(private readonly db: Database) {}

  private static buildFilterConditions(filter: BulkMoveFilterInput, params: unknown[]): string {
    const conditions: string[] = [];

    if (filter.stageId !== undefined) {
      params.push(filter.stageId);
      conditions.push(`stage_id = $${params.length}`);
    }
    if (filter.owner !== undefined) {
      params.push(filter.owner);
      conditions.push(`owner = $${params.length}`);
    }
    if (filter.status !== undefined) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.valueMin !== undefined) {
      params.push(filter.valueMin);
      conditions.push(`value >= $${params.length}`);
    }
    if (filter.valueMax !== undefined) {
      params.push(filter.valueMax);
      conditions.push(`value <= $${params.length}`);
    }
    if (filter.createdAfter !== undefined) {
      params.push(filter.createdAfter);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filter.createdBefore !== undefined) {
      params.push(filter.createdBefore);
      conditions.push(`created_at <= $${params.length}`);
    }

    return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
  }

  private static mapJob(row: BulkMoveJobRow): BulkMoveJob {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      filterHash: row.filter_hash,
      filter: row.filter,
      targetStageId: row.target_stage_id,
      status: row.status,
      totalItems: row.total_items,
      doneCount: row.done_count,
      skippedCount: row.skipped_count,
      cursorId: row.cursor_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createJobWithSnapshot(
    workspaceId: string,
    filterHash: string,
    filter: BulkMoveFilterInput,
    targetStageId: string,
  ): Promise<BulkMoveJob> {
    return this.db.transaction(async (client) => {
      const stageResult = await client.query(
        `SELECT 1 FROM stages WHERE id = $1 AND workspace_id = $2`,
        [targetStageId, workspaceId],
      );

      if (stageResult.rowCount === 0) {
        throw new NotFoundError(ERROR_CODES.STAGE_NOT_FOUND);
      }

      const inserted = await client.query<BulkMoveJobRow>(
        `INSERT INTO bulk_move_jobs (workspace_id, filter_hash, filter, target_stage_id, status, total_items)
         VALUES ($1, $2, $3, $4, 'pending', 0)
         ON CONFLICT (workspace_id, filter_hash) WHERE status IN ('pending', 'running') DO NOTHING
         RETURNING *`,
        [workspaceId, filterHash, JSON.stringify(filter), targetStageId],
      );

      if (inserted.rowCount === 0) {
        const existing = await client.query<BulkMoveJobRow>(
          `SELECT * FROM bulk_move_jobs
           WHERE workspace_id = $1 AND filter_hash = $2 AND status IN ('pending', 'running')`,
          [workspaceId, filterHash],
        );
        return BulkMovesRepository.mapJob(existing.rows[0]);
      }

      const job = inserted.rows[0];

      const filterParams: unknown[] = [workspaceId];
      const filterClause = BulkMovesRepository.buildFilterConditions(filter, filterParams);

      const matches = await client.query<{ id: string; version: number }>(
        `SELECT id, version FROM opportunities
         WHERE workspace_id = $1${filterClause}
         ORDER BY id
         LIMIT ${MAX_SNAPSHOT_ITEMS}`,
        filterParams,
      );

      if (matches.rows.length > 0) {
        await client.query(
          `INSERT INTO bulk_move_job_items (job_id, opportunity_id, expected_version)
           SELECT $1, unnest($2::uuid[]), unnest($3::int[])`,
          [job.id, matches.rows.map((row) => row.id), matches.rows.map((row) => row.version)],
        );
      }

      const finalStatus = matches.rows.length === 0 ? 'completed' : 'pending';

      const updatedJobRow = await client.query<BulkMoveJobRow>(
        `UPDATE bulk_move_jobs SET total_items = $1, status = $2, updated_at = now() WHERE id = $3 RETURNING *`,
        [matches.rows.length, finalStatus, job.id],
      );

      return BulkMovesRepository.mapJob(updatedJobRow.rows[0]);
    });
  }
}
