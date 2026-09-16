import { Queue } from 'bullmq';
import { redis } from '../redis/redis.js';

export const jobQueue = new Queue('jobs', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: false,
    removeOnFail: false,
  },
});
