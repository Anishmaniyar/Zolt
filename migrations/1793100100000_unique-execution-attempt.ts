import type { MigrationBuilder } from 'node-pg-migrate';

// One row per (job, attempt) is the execution model the retry and recovery
// paths already assume. Duplicate delivery used to be able to insert a second
// attempt-1 row, so existing duplicates are collapsed first: a started or
// terminal row wins over a QUEUED one, then the oldest row wins.
const rankedDuplicates = `
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY job_id, attempt
        ORDER BY
          (status NOT IN ('QUEUED', 'SCHEDULED')) DESC,
          created_at ASC,
          id ASC
      ) AS duplicate_rank
    FROM executions
  ) ranked
  WHERE duplicate_rank > 1
`;

export function up(pgm: MigrationBuilder): void {
  // Dependent rows of the duplicates go first (no cascade on these tables).
  pgm.sql(`DELETE FROM outbox WHERE execution_id IN (${rankedDuplicates})`);
  pgm.sql(`DELETE FROM leases WHERE execution_id IN (${rankedDuplicates})`);
  pgm.sql(`DELETE FROM executions WHERE id IN (${rankedDuplicates})`);

  pgm.addConstraint('executions', 'executions_job_id_attempt_unique', {
    unique: ['job_id', 'attempt'],
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropConstraint('executions', 'executions_job_id_attempt_unique', {
    ifExists: true,
  });
}
