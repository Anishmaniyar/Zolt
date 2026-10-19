import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { globalErrorHandler } from '../middleware/error.middleware.js';

import rootRouter from './routes.js';
import { checkSystemHealth } from '../utils/health.service.js';
import { requestLogger } from '../middleware/requestLogger.middlewares.js';

const app = express();

app.use(express.json());

app.use(requestLogger);

// Serves the health probe by reporting Postgres and Redis reachability.
app.get('/health', async (req, res, next) => {
  try {
    const health = await checkSystemHealth();

    res.status(health.status === 'UP' ? 200 : 503).json(health);
  } catch (error) {
    next(error);
  }
});

app.use('/api/v1', rootRouter);

//startScheduler();

app.use(globalErrorHandler);

export default app;
