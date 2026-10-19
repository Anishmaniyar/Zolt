import type { Express } from 'express';

import { requestLogger } from '../middleware/requestLogger.middlewares.js';

// Registers request logging and request IDs for every incoming request.
export function registerLogger(app: Express): void {
  app.use(requestLogger);
}
