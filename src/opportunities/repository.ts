import {
  Opportunity,
  CreateOpportunityInput,
  ListOpportunitiesPage,
  OpportunityRow,
  ListCursorPayload,
} from './types';
import { Database } from '../db/database';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors';
import { ERROR_CODES } from '../shared/constants/error-codes';
import { encodeCursor, decodeCursor } from '../utils/cursor';

const DEFAULT_LIST_LIMIT = 50;

function parseCursor(cursor: string): ListCursorPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(decodeCursor(cursor));
  } catch {
    throw new ValidationError(ERROR_CODES.INVALID_CURSOR);
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as ListCursorPayload).createdAt !== 'string' ||
    typeof (payload as ListCursorPayload).id !== 'string'
  ) {
    throw new ValidationError(ERROR_CODES.INVALID_CURSOR);
  }

  return payload as ListCursorPayload;
}

export class OpportunitiesRepository {
  constructor(private readonly db: Database) {}

  private static mapOpportunity(row: OpportunityRow): Opportunity {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      value: Number(row.value),
      status: row.status,
      owner: row.owner,
      stageId: row.stage_id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createOpportunity(input: CreateOpportunityInput): Promise<Opportunity> {
    const rows = await this.db.query<OpportunityRow>(
      `INSERT INTO opportunities (workspace_id, name, value, status, owner, stage_id)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE EXISTS (SELECT 1 FROM stages WHERE id = $6 AND workspace_id = $1)
       RETURNING *`,
      [input.workspaceId, input.name, input.value, input.status, input.owner, input.stageId],
    );

    if (rows.length === 0) {
      throw new NotFoundError(ERROR_CODES.STAGE_NOT_FOUND);
    }

    return OpportunitiesRepository.mapOpportunity(rows[0]);
  }

  async moveOpportunity(
    workspaceId: string,
    opportunityId: string,
    toStageId: string,
    expectedVersion: number,
    movedBy: string | null,
  ): Promise<Opportunity> {
    return this.db.transaction(async (client) => {
      const currentResult = await client.query<OpportunityRow>(
        `SELECT * FROM opportunities WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [opportunityId, workspaceId],
      );

      if (currentResult.rowCount === 0) {
        throw new NotFoundError(ERROR_CODES.OPPORTUNITY_NOT_FOUND);
      }

      const currentRow = currentResult.rows[0];

      if (currentRow.version !== expectedVersion) {
        throw new ConflictError(ERROR_CODES.VERSION_CONFLICT);
      }

      const stageResult = await client.query(
        `SELECT 1 FROM stages WHERE id = $1 AND workspace_id = $2`,
        [toStageId, workspaceId],
      );

      if (stageResult.rowCount === 0) {
        throw new NotFoundError(ERROR_CODES.STAGE_NOT_FOUND);
      }

      const updatedResult = await client.query<OpportunityRow>(
        `UPDATE opportunities
         SET stage_id = $1, version = version + 1, updated_at = now()
         WHERE id = $2
         RETURNING *`,
        [toStageId, opportunityId],
      );

      await client.query(
        `INSERT INTO transitions (workspace_id, opportunity_id, from_stage_id, to_stage_id, moved_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [workspaceId, opportunityId, currentRow.stage_id, toStageId, movedBy],
      );

      return OpportunitiesRepository.mapOpportunity(updatedResult.rows[0]);
    });
  }

  async listOpportunitiesInStage(
    workspaceId: string,
    stageId: string,
    cursor: string | null,
    limit: number = DEFAULT_LIST_LIMIT,
  ): Promise<ListOpportunitiesPage> {
    const after: ListCursorPayload | null = cursor ? parseCursor(cursor) : null;

    const stageRows = await this.db.query(`SELECT 1 FROM stages WHERE id = $1 AND workspace_id = $2`, [
      stageId,
      workspaceId,
    ]);

    if (stageRows.length === 0) {
      throw new NotFoundError(ERROR_CODES.STAGE_NOT_FOUND);
    }

    // Fetch one extra row (limit + 1) so we know "is there a next page"
    const rows = await this.db.query<OpportunityRow>(
      `SELECT *, created_at::text AS created_at_cursor FROM opportunities
       WHERE workspace_id = $1 AND stage_id = $2
         AND ($3::timestamptz IS NULL OR (created_at, id) > ($3::timestamptz, $4::uuid))
       ORDER BY created_at, id
       LIMIT $5`,
      [workspaceId, stageId, after?.createdAt ?? null, after?.id ?? null, limit + 1],
    );

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(OpportunitiesRepository.mapOpportunity);
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor(JSON.stringify({ createdAt: lastRow.created_at_cursor, id: lastRow.id }))
        : null;

    return { items, nextCursor };
  }
}
