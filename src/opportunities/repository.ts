import { Opportunity, CreateOpportunityInput, OpportunityRow } from './types';
import { Database } from '../db/database';
import { NotFoundError } from '../shared/errors';
import { ERROR_CODES } from '../shared/constants/error-codes';

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
}
