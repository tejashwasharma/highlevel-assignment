import { OpportunitiesRepository } from './repository';
import { CreateOpportunityInput, Opportunity, ListOpportunitiesPage } from './types';

export class OpportunitiesService {
  constructor(private readonly repository: OpportunitiesRepository) {}

  async createOpportunity(input: CreateOpportunityInput): Promise<Opportunity> {
    return this.repository.createOpportunity(input);
  }

  async moveOpportunity(
    workspaceId: string,
    opportunityId: string,
    toStageId: string,
    expectedVersion: number,
    movedBy: string | null,
  ): Promise<Opportunity> {
    return this.repository.moveOpportunity(
      workspaceId,
      opportunityId,
      toStageId,
      expectedVersion,
      movedBy,
    );
  }

  async listOpportunitiesInStage(
    workspaceId: string,
    stageId: string,
    cursor: string | null,
    limit: number,
  ): Promise<ListOpportunitiesPage> {
    return this.repository.listOpportunitiesInStage(workspaceId, stageId, cursor, limit);
  }
}
