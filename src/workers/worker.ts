import { Worker } from 'bullmq';
import { redis } from '../infrastructure/redis/redis.js';
import { getJobById } from '../modules/jobs/jobs.repository.js';
import * as ExecutionService from '../modules/executions/execution.service.js';
import AppError from '../shared/errors/appError.js';
import { config } from '../config/env.config.js';
import { logger } from '../shared/logger/logger.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';

export const workerRedisConnection = redis.duplicate({
  maxRetriesPerRequest: null,
});

logger.info(
  {
    event: 'worker.started',
    workerId: config.worker.id,
    concurrency: config.worker.concurrency,
  },
  'WORKER STARTED',
);

console.log(`📡 [${config.worker.id}] worker booted (Concurrency: ${config.worker.concurrency})`);

const worker = new Worker(
  'jobs',
  async (job) => {
    switch (job.name) {
      case 'execute-job': {
        console.log(`⏱️  [${config.worker.id}] STARTing Job #${job.id} - Type: ${job.name}`);
        logger.info(
          {
            event: 'worker.job_started',
            workerId: config.worker.id,
            jobId: job.id,
            jobName: job.name,
          },
          'WORKER JOB STARTED',
        );

        const { jobId } = job.data;

        if (!jobId) {
          throw new AppError('Job ID is missing from queue data', 400);
        }

        const jobData = await getJobById(jobId);

        if (!jobData) {
          throw new AppError(`Job ${jobId} not found`, 404);
        }

        await ExecutionService.createNewExecution(jobData, config.worker.id);

        console.log(`✅ [${config.worker.id}] ENDed Job #${job.id}`);
        logger.info(
          {
            event: 'worker.job_completed',
            workerId: config.worker.id,
            jobId: job.id,
            jobName: job.name,
          },
          'WORKER JOB COMPLETED',
        );

        return;
      }

      case 'execute-execution': {
        console.log(`⏱️  [${config.worker.id}] STARTing Job #${job.id} - Type: ${job.name}`);
        logger.info(
          {
            event: 'worker.job_started',
            workerId: config.worker.id,
            jobId: job.id,
            jobName: job.name,
          },
          'WORKER JOB STARTED',
        );

        const { executionId } = job.data;

        if (!executionId) {
          throw new AppError('Execution ID is missing from queue data', 400);
        }

        await ExecutionService.executeExistingExecution(executionId, config.worker.id);

        console.log(`✅ [${config.worker.id}] ENDed Job #${job.id}`);
        logger.info(
          {
            event: 'worker.job_completed',
            workerId: config.worker.id,
            jobId: job.id,
            jobName: job.name,
          },
          'WORKER JOB COMPLETED',
        );

        return;
      }

      default:
        throw new AppError(`Unknown queue job type: ${job.name}`, 400);
    }
  },
  {
    connection: workerRedisConnection,
    concurrency: config.worker.concurrency,
  },
);

startHeartbeat();

async function gracefulShutdown(signal: string) {
  logger.info(
    {
      event: 'worker.stopping',
      workerId: config.worker.id,
      signal,
    },
    'WORKER STOPPING',
  );

  stopHeartbeat();
  await worker.close();
  await workerRedisConnection.quit();

  logger.info(
    {
      event: 'worker.stopped',
      workerId: config.worker.id,
      signal,
    },
    'WORKER STOPPED',
  );

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

worker.on('completed', (job) =>
  logger.info(
    {
      event: 'worker.completed',
      workerId: config.worker.id,
      jobId: job.id,
      jobName: job.name,
    },
    'WORKER JOB FINISHED SUCCESSFULLY',
  ),
);

worker.on('failed', (job, err) =>
  logger.error(
    {
      event: 'worker.failed',
      workerId: config.worker.id,
      jobId: job?.id,
      jobName: job?.name,
      error: err,
    },
    'WORKER JOB FAILED',
  ),
);
