import express, { type Express } from 'express';

import { registerErrorHandling } from './error-handler.js';
import { registerLogger } from './logger.js';
import { registerRoutes } from './routes.js';
import { metricsMiddleware } from '../middleware/metrics.middleware.js';
import { metricsHandler } from '../shared/metrics/metrics.handler.js';

// Configures the Express application.
//
// Registration order matters:
// 1. Request logging runs first so every request gets an ID and is logged,
//    including requests that later fail validation or matching.
// 2. Body parsing must run before any route that reads req.body.
// 3. Application routes.
// 4. Not-found handling runs after all routes.
// 5. The global error handler is registered last.
export function bootstrap(app: Express): void {
  registerLogger(app);

  app.use(express.json());

  app.use(metricsMiddleware);

  registerRoutes(app);

  app.use('/metrics', metricsHandler);

  registerErrorHandling(app);
}
