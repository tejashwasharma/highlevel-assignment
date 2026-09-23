export type BulkMoveJobStatus = 'pending' | 'running' | 'completed' | 'failed';

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
  cursorId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmitBulkMoveInput {
  workspaceId: string;
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
  cursor_id: number | null;
  created_at: Date;
  updated_at: Date;
}
