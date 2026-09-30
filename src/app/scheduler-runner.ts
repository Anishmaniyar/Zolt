import dotenv from 'dotenv';
dotenv.config();

import { startScheduler, stopScheduler } from '../modules/scheduler/scheduler.service.js';
import { closeQueue } from '../infrastructure/queue/queue.js';
import { closeRedis } from '../infrastructure/redis/redis.js';
import { closeDatabase } from '../infrastructure/database/pool.js';

// Boot an isolated scheduler engine thread
startScheduler();

// Stops the scheduler plus queue, Redis, and Postgres connections, then exits.
async function gracefulShutdown(signal: string) {
  console.log(`${signal} received. Shutting down scheduler...`);

  stopScheduler();

  // close resources owned by scheduler
  await closeQueue();
  await closeRedis();
  await closeDatabase();

  console.log('Scheduler shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
