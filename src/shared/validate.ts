import { NextFunction, Request, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationError, FieldError } from './errors';
import { ERROR_CODES } from './constants/error-codes';

export function validateDto<T extends object>(
  DtoClass: new () => T,
  source: 'body' | 'query' = 'body',
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const instance = plainToInstance(DtoClass, req[source], {
      enableImplicitConversion: true,
      excludeExtraneousValues: false,
    });

    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      const details: FieldError[] = errors.map((error) => ({
        field: error.property,
        constraints: error.constraints ? Object.values(error.constraints) : ['is invalid'],
      }));
      throw new ValidationError(ERROR_CODES.DTO_VALIDATION_FAILED, details);
    }

    Object.defineProperty(req, source, {
      value: instance,
      writable: true,
      configurable: true,
    });
    next();
  };
}
