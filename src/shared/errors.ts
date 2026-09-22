import { HTTP_STATUS, HttpStatus } from './constants/http-status';
import { ERROR_MESSAGES } from './constants/messages';
import { ErrorCode } from './constants/error-codes';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: HttpStatus,
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

export class ValidationError extends AppError {
  constructor(code: ErrorCode) {
    super(code, HTTP_STATUS.BAD_REQUEST);
  }
}
