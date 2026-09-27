import { pool } from '../../infrastructure/database/pool.js';
import * as OutboxRepository from '../outbox/outbox.repository.js';

// export const findDueJobs = async () => {
//   const result = await pool.query(
//     `
//             SELECT *
//             FROM jobs
//             WHERE status = 'SCHEDULED'
//                 AND run_at <= NOW()
//             LIMIT 100
//         `,
//     [],
//   );

//   return result.rows;
// };

// export const ClaimJobs = async (ids: string[]) => {
//   const result = await pool.query(
//     `
//             UPDATE jobs
//             SET status = 'QUEUED', updated_at = NOW()
//             WHERE id = ANY($1)
//             RETURNING *
//         `,
//     [ids],
//   );

//   return result.rows;
// };

export const processJobTransaction = async (batch: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const claimJobsQuery = `
      UPDATE jobs
      SET status = 'QUEUED', updated_at = NOW()
      WHERE id IN (
        SELECT id
        FROM jobs
        WHERE status = 'SCHEDULED' 
          AND run_at <= NOW()
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    const result = await client.query({ text: claimJobsQuery, values: [batch] });

    for (const job of result.rows) {
      await OutboxRepository.createJobOutbox(client, job.id);
    }

    await client.query('COMMIT');
    console.log(`Transaction committed! Claimed ${result.rows.length} jobs.`);

    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction failed! Aborted and rolled back.', error);
    throw error;
  } finally {
    client.release();
  }
};

export const processExecutionTransactions = async (batch: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const claimExecutionQuery = `
      UPDATE executions
      SET
        status = 'QUEUED',
        updated_at = NOW()
      WHERE id IN (
      SELECT id
      FROM executions
      WHERE status = 'SCHEDULED'
      AND retry_at <= NOW()
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;
    const result = await client.query({ text: claimExecutionQuery, values: [batch] });

    for (const execution of result.rows) {
      await OutboxRepository.createExecutionOutbox(client, execution.id);
    }

    await client.query('COMMIT');
    console.log(`Transaction committed! Claimed ${result.rows.length} Executions.`);

    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction failed! Aborted and rolled back.', error);
    throw error;
  } finally {
    client.release();
  }
};
