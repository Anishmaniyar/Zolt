import { Worker } from 'bullmq';
import { redis } from '../infrastructure/redis/redis.js';
import { getJobById } from '../modules/jobs/jobs.repository.js';
import * as ExecutionService from '../modules/executions/execution.service.js';
import AppError from '../shared/errors/appError.js';
import { config } from '../config/env.config.js';
import { logger } from '../shared/logger/logger.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { startMetricsServer } from '../shared/metrics/metrics.server.js';

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

const metricsServer = startMetricsServer(config.ports.worker);

const worker = new Worker(
  'jobs',
  // Routes queued BullMQ jobs to execution creation or execution running.
  async (job) => {
    switch (job.name) {
      case 'execute-job': {
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

// Stops the heartbeat, closes the worker and its Redis connection, then exits.
async function gracefulShutdown(signal: string) {
  logger.info(
    {
      event: 'worker.stopping',
      workerId: config.worker.id,
      signal,
    },
    'WORKER STOPPING',
  );

  // Drain first: active handlers keep renewing their leases while they finish,
  // so a shutdown cannot look like a crash to the recovery path.
  await worker.close();
  stopHeartbeat();
  await workerRedisConnection.quit();

  await new Promise<void>((resolve, reject) => {
    metricsServer.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

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
