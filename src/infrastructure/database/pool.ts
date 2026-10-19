import { Pool } from 'pg';

import { config } from '../../config/env.config.js';
import { logger } from '../../shared/logger/logger.js';

export const pool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (error) => {
  logger.error({ event: 'db.pool_error', error }, 'DATABASE POOL ERROR');
});

// Closes all pooled Postgres connections.
export async function closeDatabase() {
  await pool.end();
}
