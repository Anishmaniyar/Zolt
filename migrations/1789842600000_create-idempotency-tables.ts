import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('idempotency_records', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },

    idempotency_key: {
      type: 'uuid',
      notNull: true,
      unique: true,
    },

    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'PENDING',
    },

    job_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
    },
  });

  pgm.addConstraint('idempotency_records', 'idempotency_status_check', {
    check: "status IN ('PENDING', 'PROCESSING', 'COMPLETED')",
  });

  pgm.addConstraint('idempotency_records', 'idempotency_job_id_fkey', {
    foreignKeys: {
      columns: 'job_id',
      references: 'jobs(id)',
      onDelete: 'CASCADE',
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('idempotency_records');
}
