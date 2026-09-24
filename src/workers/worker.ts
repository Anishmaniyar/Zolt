import { Worker } from 'bullmq';
import { redis } from '../infrastructure/redis/redis.js';
import { getJobById } from '../modules/jobs/jobs.repository.js';
import * as ExecutionService from '../modules/executions/execution.service.js';
import AppError from '../shared/errors/appError.js';
import { success } from 'zod';

const workerRedisConnection = redis.duplicate({
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'jobs',
  async (job) => {
    switch (job.name) {
      case 'execute-job': {
        const { jobId } = job.data;

        if (!jobId) {
          throw new AppError('Job ID is missing from queue data', 400);
        }

        const jobData = await getJobById(jobId);

        if (!jobData) {
          throw new AppError(`Job ${jobId} not found`, 404);
        }

        await ExecutionService.createNewExecution(jobData);

        return;
      }

      case 'execute-execution': {
        const { executionId } = job.data;

        if (!executionId) {
          throw new AppError('Execution ID is missing from queue data', 400);
        }

        await ExecutionService.executeExistingExecution(executionId);

        return;
      }

      default:
        throw new AppError(`Unknown queue job type: ${job.name}`, 400);
    }
  },
  {
    connection: workerRedisConnection,
    concurrency: 5,
  },
);

worker.on('completed', (job) => console.log(`Job ${job.id} finished successfully`));

worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));
