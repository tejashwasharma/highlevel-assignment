export interface Opportunity {
  id: string;
  workspaceId: string;
  name: string;
  value: number;
  status: 'open' | 'won' | 'lost' | 'abandoned';
  owner: string;
  stageId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOpportunityInput {
  workspaceId: string;
  name: string;
  value: number;
  status: Opportunity['status'];
  owner: string;
  stageId: string;
}

export interface OpportunityRow {
  id: string;
  workspace_id: string;
  name: string;
  value: string;
  status: Opportunity['status'];
  owner: string;
  stage_id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}
