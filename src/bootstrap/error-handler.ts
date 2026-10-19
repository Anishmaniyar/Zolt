import type { Express } from 'express';

import { globalErrorHandler } from '../middleware/error.middleware.js';
import { notFoundHandler } from '../middleware/not-found.middleware.js';

// Registers the not-found handler and the global error handler.
// The error handler must stay last so it can catch every upstream error.
export function registerErrorHandling(app: Express): void {
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
}
