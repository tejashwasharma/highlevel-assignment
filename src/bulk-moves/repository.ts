import {
  BulkMoveJob,
  BulkMoveJobRow,
  BulkMoveJobItem,
  BulkMoveJobItemRow,
  BulkMoveFilterInput,
  ChunkApplyResult,
} from './types';
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

  private static mapJobItem(row: BulkMoveJobItemRow): BulkMoveJobItem {
    return {
      id: row.id,
      jobId: row.job_id,
      opportunityId: row.opportunity_id,
      status: row.status,
      expectedVersion: row.expected_version,
      processedAt: row.processed_at,
    };
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
      skippedOpportunityIds: row.skipped_opportunity_ids,
      cursorId: row.cursor_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

 async createJobPending(
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
         VALUES ($1, $2, $3, $4, 'materializing', 0)
         ON CONFLICT (workspace_id, filter_hash) WHERE status IN ('materializing', 'pending', 'running') DO NOTHING
         RETURNING *`,
        [workspaceId, filterHash, JSON.stringify(filter), targetStageId],
      );

      if (inserted.rowCount === 0) {
        const existing = await client.query<BulkMoveJobRow>(
          `SELECT * FROM bulk_move_jobs
           WHERE workspace_id = $1 AND filter_hash = $2 AND status IN ('materializing', 'pending', 'running')`,
          [workspaceId, filterHash],
        );
        return BulkMovesRepository.mapJob(existing.rows[0]);
      }

      return BulkMovesRepository.mapJob(inserted.rows[0]);
    });
  }

  async materializeSnapshot(job: BulkMoveJob): Promise<BulkMoveJob> {
    return this.db.transaction(async (client) => {
      const filterParams: unknown[] = [job.workspaceId];
      const filterClause = BulkMovesRepository.buildFilterConditions(job.filter, filterParams);

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

  async createJobWithSnapshot(
    workspaceId: string,
    filterHash: string,
    filter: BulkMoveFilterInput,
    targetStageId: string,
  ): Promise<BulkMoveJob> {
    const job = await this.createJobPending(workspaceId, filterHash, filter, targetStageId);
    if (job.status !== 'materializing') {
      return job;
    }
    return this.materializeSnapshot(job);
  }

  async getJob(workspaceId: string, jobId: string): Promise<BulkMoveJob> {
    const rows = await this.db.query<BulkMoveJobRow>(
      `SELECT * FROM bulk_move_jobs WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, jobId],
    );

    if (rows.length === 0) {
      throw new NotFoundError(ERROR_CODES.BULK_MOVE_JOB_NOT_FOUND);
    }

    return BulkMovesRepository.mapJob(rows[0]);
  }

  async claimNextChunk(
    jobId: string,
    cursorId: number | null,
    limit: number,
  ): Promise<BulkMoveJobItem[]> {
    const rows = await this.db.query<BulkMoveJobItemRow>(
      `SELECT * FROM bulk_move_job_items
       WHERE job_id = $1 AND ($2::bigint IS NULL OR id > $2::bigint)
       ORDER BY id
       LIMIT $3`,
      [jobId, cursorId, limit],
    );
    return rows.map(BulkMovesRepository.mapJobItem);
  }

  async applyChunk(job: BulkMoveJob, items: BulkMoveJobItem[]): Promise<ChunkApplyResult> {
    if (items.length === 0) {
      return { doneCount: 0, skippedCount: 0, lastItemId: job.cursorId ?? 0 };
    }

    return this.db.transaction(async (client) => {
      const opportunityIds = items.map((item) => item.opportunityId);
      const expectedVersions = items.map((item) => item.expectedVersion);

      const movedResult = await client.query<{ opportunity_id: string }>(
        `WITH candidates AS (
           SELECT unnest($1::uuid[]) AS opportunity_id, unnest($2::int[]) AS expected_version
         ),
         matched AS (
           SELECT o.id, o.stage_id AS from_stage_id
           FROM opportunities o
           JOIN candidates c ON o.id = c.opportunity_id AND o.version = c.expected_version
           FOR UPDATE OF o
         ),
         updated AS (
           UPDATE opportunities o
           SET stage_id = $3, version = o.version + 1, updated_at = now()
           FROM matched m
           WHERE o.id = m.id
           RETURNING o.id AS opportunity_id, m.from_stage_id
         )
         INSERT INTO transitions (workspace_id, opportunity_id, from_stage_id, to_stage_id, moved_by)
         SELECT $4, opportunity_id, from_stage_id, $3, $5
         FROM updated
         RETURNING opportunity_id`,
        [opportunityIds, expectedVersions, job.targetStageId, job.workspaceId, `bulk-move:${job.id}`],
      );

      const movedOpportunityIds = new Set(movedResult.rows.map((row) => row.opportunity_id));

      const doneItemIds: number[] = [];
      const skippedItemIds: number[] = [];
      const skippedOpportunityIds: string[] = [];
      for (const item of items) {
        if (movedOpportunityIds.has(item.opportunityId)) {
          doneItemIds.push(item.id);
        } else {
          skippedItemIds.push(item.id);
          skippedOpportunityIds.push(item.opportunityId);
        }
      }

      if (doneItemIds.length > 0) {
        await client.query(
          `UPDATE bulk_move_job_items SET status = 'done', processed_at = now() WHERE id = ANY($1::bigint[])`,
          [doneItemIds],
        );
      }
      if (skippedItemIds.length > 0) {
        await client.query(
          `UPDATE bulk_move_job_items SET status = 'skipped_conflict', processed_at = now() WHERE id = ANY($1::bigint[])`,
          [skippedItemIds],
        );
      }

      const doneCount = doneItemIds.length;
      const skippedCount = skippedItemIds.length;
      const lastItemId = items[items.length - 1].id;

      await client.query(
        `UPDATE bulk_move_jobs
         SET cursor_id = $1, done_count = done_count + $2, skipped_count = skipped_count + $3,
             skipped_opportunity_ids = skipped_opportunity_ids || $4::uuid[],
             status = 'running', updated_at = now()
         WHERE id = $5`,
        [lastItemId, doneCount, skippedCount, skippedOpportunityIds, job.id],
      );

      return { doneCount, skippedCount, lastItemId };
    });
  }

  async markJobCompleted(jobId: string): Promise<BulkMoveJob> {
    const rows = await this.db.query<BulkMoveJobRow>(
      `UPDATE bulk_move_jobs SET status = 'completed', updated_at = now() WHERE id = $1 RETURNING *`,
      [jobId],
    );
    return BulkMovesRepository.mapJob(rows[0]);
  }

  async findNextActiveJob(): Promise<BulkMoveJob | null> {
    const rows = await this.db.query<BulkMoveJobRow>(
      `SELECT * FROM bulk_move_jobs
       WHERE status IN ('materializing', 'pending', 'running')
       ORDER BY updated_at ASC
       LIMIT 1`,
    );
    return rows[0] ? BulkMovesRepository.mapJob(rows[0]) : null;
  }
}
