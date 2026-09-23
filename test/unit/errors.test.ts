import { NotFoundError, ConflictError, ValidationError, AppError } from '../../src/shared/errors';
import { HTTP_STATUS } from '../../src/shared/constants/http-status';
import { ERROR_CODES } from '../../src/shared/constants/error-codes';
import { ERROR_MESSAGES } from '../../src/shared/constants/messages';

describe('AppError subclasses', () => {
  it('NotFoundError always maps to 404, regardless of code', () => {
    const err = new NotFoundError(ERROR_CODES.OPPORTUNITY_NOT_FOUND);
    expect(err.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    expect(err.code).toBe(ERROR_CODES.OPPORTUNITY_NOT_FOUND);
    expect(err.message).toBe(ERROR_MESSAGES[ERROR_CODES.OPPORTUNITY_NOT_FOUND]);
  });

  it('ConflictError always maps to 409', () => {
    const err = new ConflictError(ERROR_CODES.VERSION_CONFLICT);
    expect(err.statusCode).toBe(HTTP_STATUS.CONFLICT);
  });

  it('ValidationError always maps to 400, and carries field details when given', () => {
    const details = [{ field: 'name', constraints: ['name should not be empty'] }];
    const err = new ValidationError(ERROR_CODES.DTO_VALIDATION_FAILED, details);
    expect(err.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(err.details).toEqual(details);
  });

  it('the message always comes from ERROR_MESSAGES[code], never a caller-supplied string', () => {
    const err = new NotFoundError(ERROR_CODES.STAGE_NOT_FOUND);
    expect(err.message).toBe(ERROR_MESSAGES[ERROR_CODES.STAGE_NOT_FOUND]);
  });

  it('is a real Error, with the subclass name, so instanceof/stack traces behave correctly', () => {
    const err = new NotFoundError(ERROR_CODES.OPPORTUNITY_NOT_FOUND);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('NotFoundError');
  });
});
