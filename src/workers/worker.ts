import { Worker } from 'bullmq';
import { redis } from '../infrastructure/redis/redis.js';

const worker = new Worker('jobs', async (job) => {}, { connection: redis, concurrency: 5 });
