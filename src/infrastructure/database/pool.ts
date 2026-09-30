import { Pool } from 'pg';

import { config } from '../../config/env.config.js';

export const pool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

// Closes all pooled Postgres connections.
export async function closeDatabase() {
  await pool.end();
}
