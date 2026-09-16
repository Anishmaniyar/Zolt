import { Redis } from 'ioredis';
import { config } from '../../config/env.config.js';

export const redis = new Redis(config.redis.url, {
  retryStrategy(times: number): number | null {
    const delay = Math.min(times * 50, 2000);

    console.warn(`[Redis] Connection lost. Retry attempt #${times} in ${delay}ms...`);

    return delay;
  },
});

redis.on('connect', () => {
  console.log('🚀 [Redis] Connecting...');
});

redis.on('ready', () => {
  console.log('✅ [Redis] Ready');
});

redis.on('error', (error: Error) => {
  console.error('❌ [Redis] Error:', error);
});

redis.on('close', () => {
  console.warn('⚠️ [Redis] Connection closed');
});

export async function closeRedis(): Promise<void> {
  console.log('[Redis] Closing connection...');
  await redis.quit();
}
