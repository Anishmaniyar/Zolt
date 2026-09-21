import { pool } from '../../infrastructure/database/pool.js';
import type { GetJobsQuery } from './jobs.types.js';

export interface CreateJobData {
  title: string;
  type: string;
  schedule_type: 'IMMEDIATE' | 'ONCE';
  payload?: Record<string, unknown>;
  run_at: Date;
  max_attempts: number;
}

export const createJob = async (data: CreateJobData) => {
  const result = await pool.query(
    `
      INSERT INTO jobs (
        title,
        type,
        schedule_type,
        payload,
        run_at,
        max_attempts
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `,
    [
      data.title,
      data.type,
      data.schedule_type,
      data.payload ?? null,
      data.run_at,
      data.max_attempts,
    ],
  );

  return result.rows[0];
};

export const getJobById = async (id: string) => {
  const result = await pool.query(
    `
      SELECT *
      FROM jobs
      WHERE id = $1;
    `,
    [id],
  );

  return result.rows[0];
};

export const getJobs = async (query: GetJobsQuery) => {
  // 1. Fall back to safe defaults if parameters are missing
  const page = query.page || 1;
  const limit = query.limit || 10;
  const sortBy = query.sortBy || 'createdAt';
  const order = query.order || 'DESC';

  const offset = (page - 1) * limit;

  const values: unknown[] = [];
  const conditions: string[] = [];

  if (query.status) {
    values.push(query.status);
    conditions.push(`status = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortColumnMap = {
    createdAt: 'created_at',
    runAt: 'run_at',
  } as const;

  // 2. Safely resolve column or fall back to 'created_at' if an unexpected key slips through
  const sortColumn = sortColumnMap[sortBy] || 'created_at';

  values.push(limit);
  const limitParameter = `$${values.length}`;

  values.push(offset);
  const offsetParameter = `$${values.length}`;

  const jobQuery = `
    SELECT *
    FROM jobs
    ${whereClause}
    ORDER BY ${sortColumn} ${order.toUpperCase()}
    LIMIT ${limitParameter}
    OFFSET ${offsetParameter};
  `;

  const jobResult = await pool.query(jobQuery, values);

  const countValues: unknown[] = [];
  const countConditions: string[] = [];

  if (query.status) {
    countValues.push(query.status);
    countConditions.push(`status = $${countValues.length}`);
  }

  const countWhereClause =
    countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM jobs
    ${countWhereClause};
  `;

  const countResult = await pool.query(countQuery, countValues);
  const total = Number(countResult.rows[0].total);

  return {
    jobs: jobResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const cancelJobStatus = async (id: string) => {
  const result = await pool.query(
    `
      UPDATE jobs
      SET
        status = 'CANCELLED',
        updated_at = NOW()
      WHERE id = $1
        AND status = 'SCHEDULED'
      RETURNING *;
    `,
    [id],
  );

  return result.rows[0];
};

export const successJob = async (jobId: string) => {
  const result = await pool.query(
    `
      UPDATE jobs
      SET
        status = 'COMPLETED',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `,
    [jobId],
  );

  return result.rows[0];
};

export const failedJob = async (jobId: string) => {
  const result = await pool.query(
    `
      UPDATE jobs
      SET
        status = 'FAILED',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `,
    [jobId],
  );

  return result.rows[0];
};
