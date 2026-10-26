import type { MigrationBuilder } from 'node-pg-migrate';

// Indexes for the scheduler's hot-path scans: due retries, queue
// reconciliation, expired leases, and outbox publishing.
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('executions', ['status', 'retry_at'], {
    name: 'executions_status_retry_at_index',
    ifNotExists: true,
  });

  pgm.createIndex('executions', ['status', 'updated_at'], {
    name: 'executions_status_updated_at_index',
    ifNotExists: true,
  });

  pgm.createIndex('executions', ['job_id'], {
    name: 'executions_job_id_index',
    ifNotExists: true,
  });

  pgm.createIndex('jobs', ['status', 'updated_at'], {
    name: 'jobs_status_updated_at_index',
    ifNotExists: true,
  });

  pgm.createIndex('leases', ['lease_expires_at'], {
    name: 'leases_lease_expires_at_index',
    ifNotExists: true,
  });

  pgm.createIndex('outbox', ['status', 'created_at'], {
    name: 'outbox_status_created_at_index',
    ifNotExists: true,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('executions', ['status', 'retry_at'], {
    name: 'executions_status_retry_at_index',
    ifExists: true,
  });

  pgm.dropIndex('executions', ['status', 'updated_at'], {
    name: 'executions_status_updated_at_index',
    ifExists: true,
  });

  pgm.dropIndex('executions', ['job_id'], {
    name: 'executions_job_id_index',
    ifExists: true,
  });

  pgm.dropIndex('jobs', ['status', 'updated_at'], {
    name: 'jobs_status_updated_at_index',
    ifExists: true,
  });

  pgm.dropIndex('leases', ['lease_expires_at'], {
    name: 'leases_lease_expires_at_index',
    ifExists: true,
  });

  pgm.dropIndex('outbox', ['status', 'created_at'], {
    name: 'outbox_status_created_at_index',
    ifExists: true,
  });
}
