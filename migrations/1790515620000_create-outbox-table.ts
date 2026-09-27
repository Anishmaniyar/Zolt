import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('outbox', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },

    job_id: {
      type: 'uuid',
      unique: true,
    },

    execution_id: {
      type: 'uuid',
      unique: true,
    },

    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'PENDING',
    },

    published_at: {
      type: 'timestamp with time zone',
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

  pgm.addConstraint('outbox', 'outbox_status_check', {
    check: "status IN ('PENDING', 'PUBLISHED')",
  });

  pgm.addConstraint('outbox', 'outbox_job_id_fkey', {
    foreignKeys: {
      columns: 'job_id',
      references: 'jobs(id)',
    },
  });

  pgm.addConstraint('outbox', 'outbox_execution_id_fkey', {
    foreignKeys: {
      columns: 'execution_id',
      references: 'executions(id)',
    },
  });

  pgm.addConstraint('outbox', 'outbox_target_check', {
    check: `
      (job_id IS NOT NULL AND execution_id IS NULL)
      OR
      (job_id IS NULL AND execution_id IS NOT NULL)
    `,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('outbox');
}
