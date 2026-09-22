import { HTTP_STATUS, HttpStatus } from './constants/http-status';
import { ERROR_MESSAGES } from './constants/messages';
import { ErrorCode } from './constants/error-codes';

export interface FieldError {
  field: string;
  constraints: string[];
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: HttpStatus,
    public readonly details?: FieldError[],
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode) {
    super(code, HTTP_STATUS.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode) {
    super(code, HTTP_STATUS.CONFLICT);
  }
}

export class ValidationError extends AppError {
  constructor(code: ErrorCode, details?: FieldError[]) {
    super(code, HTTP_STATUS.BAD_REQUEST, details);
  }
}
