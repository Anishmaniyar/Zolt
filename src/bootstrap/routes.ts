import { Router, type Express } from 'express';

import jobRouter from '../modules/jobs/jobs.routes.js';
import { checkSystemHealth } from '../utils/health.service.js';
import asyncHandler from '../utils/asyncHandler.js';

// Registers the health probe and the versioned application routes.
export function registerRoutes(app: Express): void {
  // Serves the health probe by reporting Postgres and Redis reachability.
  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const health = await checkSystemHealth();

      res.status(health.status === 'UP' ? 200 : 503).json(health);
    }),
  );

  const rootRouter = Router();

  rootRouter.use(jobRouter);

  app.use('/api/v1', rootRouter);
}
