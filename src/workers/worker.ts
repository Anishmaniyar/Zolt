import { Worker } from 'bullmq';
import { redis } from '../infrastructure/redis/redis.js';
import { getJobById } from '../modules/jobs/jobs.repository.js';
import * as ExecutionService from '../modules/executions/execution.service.js';
import AppError from '../shared/errors/appError.js';
import { config } from '../config/env.config.js';

export const workerRedisConnection = redis.duplicate({
  maxRetriesPerRequest: null,
});

// a simple utility to simulate a heavy workload
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const worker = new Worker(
  'jobs',
  async (job) => {
    console.log(`📡 [${config.worker.id}] initialized (Concurrency: ${config.worker.concurrency})`);

    await delay(5000);

    switch (job.name) {
      case 'execute-job': {
        console.log(`⏱️  [${config.worker.id}] STARTing Job #${job.id} - Type: ${job.name}`);
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

    // log completion
    console.log(`✅ [${config.worker.id}] ENDed Job #${job.id}`);
  },
  {
    connection: workerRedisConnection,
    concurrency: config.worker.concurrency,
  },
);

worker.on('completed', (job) => console.log(`Job ${job.id} finished successfully`));

worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));
