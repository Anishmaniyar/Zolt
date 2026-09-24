import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { globalErrorHandler } from '../middleware/error.middleware.js';
import { startScheduler } from '../modules/scheduler/scheduler.service.js';
//import '../workers/worker.js';

import rootRouter from './routes.js';

const app = express();

app.use(express.json());

app.use('/api/v1', rootRouter);

startScheduler();

app.use(globalErrorHandler);

export default app;
