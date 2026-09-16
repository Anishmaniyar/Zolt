import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('jobs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },

    type: {
      type: 'varchar(100)',
      notNull: true,
    },

    payload: {
      type: 'jsonb',
    },

    schedule_type: {
      type: 'varchar(20)',
      notNull: true,
    },

    run_at: {
      type: 'timestamp with time zone',
      notNull: true,
    },

    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'SCHEDULED',
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

  pgm.addConstraint('jobs', 'jobs_schedule_type_check', {
    check: "schedule_type IN ('IMMEDIATE', 'ONCE')",
  });

  pgm.addConstraint('jobs', 'jobs_status_check', {
    check: "status IN ('SCHEDULED', 'COMPLETED', 'FAILED', 'CANCELLED')",
  });

  pgm.createIndex('jobs', ['status', 'run_at']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('jobs');
}
