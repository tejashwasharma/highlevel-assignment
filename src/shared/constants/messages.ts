import { ERROR_CODES, ErrorCode } from './error-codes';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.WORKSPACE_ID_REQUIRED]: 'X-Workspace-Id header is required',
  [ERROR_CODES.STAGE_NOT_FOUND]: 'Stage not found in this workspace',
  [ERROR_CODES.OPPORTUNITY_NOT_FOUND]: 'Opportunity not found in this workspace',
  [ERROR_CODES.VERSION_CONFLICT]: 'Opportunity was modified since it was last read; refresh and retry',
  [ERROR_CODES.INVALID_CURSOR]: 'cursor is invalid',
  [ERROR_CODES.DTO_VALIDATION_FAILED]: 'Request failed validation',
  [ERROR_CODES.INTERNAL_ERROR]: 'Something went wrong',
};
