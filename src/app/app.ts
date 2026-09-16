import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { globalErrorHandler } from '../middleware/error.middleware.js';

import rootRouter from './routes.js';

const app = express();

app.use(express.json());

app.use('/api/v1', rootRouter);

app.use(globalErrorHandler);

export default app;
