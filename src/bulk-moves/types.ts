export type BulkMoveJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type BulkMoveJobItemStatus = 'pending' | 'done' | 'skipped_conflict' | 'failed';

export interface BulkMoveFilterInput {
  stageId?: string;
  owner?: string;
  status?: string;
  valueMin?: number;
  valueMax?: number;
  createdAfter?: string;
  createdBefore?: string;
}

export interface BulkMoveJob {
  id: string;
  workspaceId: string;
  filterHash: string;
  filter: BulkMoveFilterInput;
  targetStageId: string;
  status: BulkMoveJobStatus;
  totalItems: number;
  doneCount: number;
  skippedCount: number;
  skippedOpportunityIds: string[];
  cursorId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmitBulkMoveInput {
  workspaceId: string;
  filterHash: string;
  filter: BulkMoveFilterInput;
  targetStageId: string;
}

export interface BulkMoveJobRow {
  id: string;
  workspace_id: string;
  filter_hash: string;
  filter: BulkMoveFilterInput;
  target_stage_id: string;
  status: BulkMoveJobStatus;
  total_items: number;
  done_count: number;
  skipped_count: number;
  skipped_opportunity_ids: string[];
  cursor_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface BulkMoveJobItem {
  id: number;
  jobId: string;
  opportunityId: string;
  status: BulkMoveJobItemStatus;
  expectedVersion: number;
  processedAt: Date | null;
}

export interface BulkMoveJobItemRow {
  id: number;
  job_id: string;
  opportunity_id: string;
  status: BulkMoveJobItemStatus;
  expected_version: number;
  processed_at: Date | null;
}

export interface ChunkApplyResult {
  doneCount: number;
  skippedCount: number;
  lastItemId: number;
}
