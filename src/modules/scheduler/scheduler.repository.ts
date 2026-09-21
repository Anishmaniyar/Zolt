import { pool } from '../../infrastructure/database/pool.js';

export const findDueJobs = async () => {
  const result = await pool.query(
    `
            SELECT *
            FROM jobs
            WHERE status = 'SCHEDULED'
                AND run_at <= NOW()
            LIMIT 100
        `,
    [],
  );

  return result.rows;
};

export const ClaimJobs = async (ids: string[]) => {
  const result = await pool.query(
    `
            UPDATE jobs
            SET status = 'QUEUED', updated_at = NOW()
            WHERE id = ANY($1)
            RETURNING *
        `,
    [ids],
  );

  return result.rows;
};
