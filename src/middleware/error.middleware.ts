import { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger/logger.js';

// Converts thrown errors into JSON responses, hiding non-operational error details.
export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  const requestId = res.locals.requestId;

  if (err.isOperational) {
    logger.warn(
      {
        event: 'http.operational_error',
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: err.statusCode,
        error: err.message,
      },
      'HTTP OPERATIONAL ERROR',
    );

    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }

  logger.error(
    {
      event: 'http.unhandled_error',
      requestId,
      method: req.method,
      path: req.originalUrl,
      error: err,
    },
    'HTTP UNHANDLED ERROR',
  );

  return res.status(500).json({
    status: 'error',
    message: 'Something went very wrong!',
  });
};
