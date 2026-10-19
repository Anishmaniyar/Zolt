import { Redis } from 'ioredis';
import { config } from '../../config/env.config.js';
import { logger } from '../../shared/logger/logger.js';

export const redis = new Redis(config.redis.url, {
  // Computes the backoff delay before the next Redis reconnect attempt.
  retryStrategy(times: number): number | null {
    const delay = Math.min(times * 50, 2000);

    logger.warn({ event: 'redis.reconnecting', attempt: times, delayMs: delay }, 'REDIS RECONNECTING');

    return delay;
  },
});

redis.on('connect', () => {
  logger.info({ event: 'redis.connecting' }, 'REDIS CONNECTING');
});

redis.on('ready', () => {
  logger.info({ event: 'redis.ready' }, 'REDIS READY');
});

redis.on('error', (error: Error) => {
  logger.error({ event: 'redis.error', error }, 'REDIS ERROR');
});

redis.on('close', () => {
  logger.warn({ event: 'redis.closed' }, 'REDIS CONNECTION CLOSED');
});

// Closes the shared Redis connection.
export async function closeRedis(): Promise<void> {
  logger.info({ event: 'redis.closing' }, 'REDIS CLOSING CONNECTION');
  await redis.quit();
}
