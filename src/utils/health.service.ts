import { pool } from '../infrastructure/database/pool.js';
import { redis } from '../infrastructure/redis/redis.js';

export interface HealthReport {
  status: 'UP' | 'DOWN';
  timestamp: string;
  components: {
    database: 'UP' | 'DOWN';
    redis: 'UP' | 'DOWN';
  };
}

// Checks Postgres and Redis reachability and reports the overall system health.
export async function checkSystemHealth(): Promise<HealthReport> {
  let database: 'UP' | 'DOWN' = 'DOWN';
  let redisStatus: 'UP' | 'DOWN' = 'DOWN';

  // check postgresql
  try {
    await pool.query('SELECT 1');
    database = 'UP';
  } catch (error) {
    console.error('Health check - Database failure: ', error);
  }

  // check redis
  try {
    const response = await redis.ping();

    if (response === 'PONG') {
      redisStatus = 'UP';
    }
  } catch (error) {
    console.error('Health check - Redis failure: ', error);
  }

  const overallStatus = database === 'UP' && redisStatus === 'UP' ? 'UP' : 'DOWN';

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    components: {
      database,
      redis: redisStatus,
    },
  };
}
