import type { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger/logger.js';
import { randomUUID } from 'node:crypto';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  const requestId = randomUUID();

  res.locals.requestId = requestId;

  res.on('finish', () => {
    const duration = Date.now() - start;

    const logPayload = {
      event: 'http.request.completed',
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    };

    if (res.statusCode >= 500) {
      logger.error(logPayload, 'HTTP request failed');
    } else if (res.statusCode >= 400) {
      logger.warn(logPayload, 'HTTP request completed with client error');
    } else {
      logger.info(logPayload, 'HTTP request completed');
    }
  });

  res.setHeader('X-Request-ID', requestId);

  next();
}
