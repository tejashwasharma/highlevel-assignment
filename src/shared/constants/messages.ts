import { ERROR_CODES, ErrorCode } from './error-codes';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.WORKSPACE_ID_REQUIRED]: 'X-Workspace-Id header is required',
  [ERROR_CODES.OPPORTUNITY_FIELDS_REQUIRED]: 'name, owner and stageId are required',
  [ERROR_CODES.OPPORTUNITY_STATUS_INVALID]: 'status must be one of: open, won, lost, abandoned',
  [ERROR_CODES.STAGE_NOT_FOUND]: 'Stage not found in this workspace',
  [ERROR_CODES.MOVE_FIELDS_REQUIRED]: 'toStageId and a numeric expectedVersion are required',
  [ERROR_CODES.OPPORTUNITY_NOT_FOUND]: 'Opportunity not found in this workspace',
  [ERROR_CODES.VERSION_CONFLICT]: 'Opportunity was modified since it was last read; refresh and retry',
  [ERROR_CODES.INVALID_CURSOR]: 'cursor is invalid',
  [ERROR_CODES.INTERNAL_ERROR]: 'Something went wrong',
};
