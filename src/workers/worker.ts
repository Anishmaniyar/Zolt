import { Worker } from 'bullmq';
import { redis } from '../infrastructure/redis/redis.js';
import { getJobById } from '../modules/jobs/jobs.repository.js';
import * as ExecutionService from '../modules/executions/execution.service.js';
import AppError from '../shared/errors/appError.js';

const workerRedisConnection = redis.duplicate({
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'jobs',
  async (job) => {
    console.log(`Processing ${job.name} with id ${job.data.jobId}`);

    // fetch job data from db
    if (!job.data?.jobId) throw new AppError('Job ID is missing from queue data', 400);

    const jobData = await getJobById(job.data.jobId);

    if (!jobData) {
      throw new AppError(`Job ${job.data.jobId} not found`, 404);
    }

    // ExecutionService owns the execution lifecycle.
    await ExecutionService.createNewExecution(jobData);

    return { success: true };
  },

  { connection: workerRedisConnection, concurrency: 5 },
);

worker.on('completed', (job) => console.log(`Job ${job.id} finished successfully`));

worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));
