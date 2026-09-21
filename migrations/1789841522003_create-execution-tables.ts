import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('executions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },

    job_id: {
      type: 'uuid',
      notNull: true,
    },

    attempt: {
      type: 'integer',
      default: 1,
      notNull: true,
    },

    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'QUEUED',
    },

    started_at: {
      type: 'timestamp with time zone',
    },

    completed_at: {
      type: 'timestamp with time zone',
    },

    error: {
      type: 'varchar(255)',
    },

    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },

    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  pgm.addConstraint('executions', 'executions_status_check', {
    check: "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')",
  });

  pgm.addConstraint('executions', 'executions_job_id_fkey', {
    foreignKeys: {
      columns: 'job_id',
      references: 'jobs(id)',
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('executions');
}
