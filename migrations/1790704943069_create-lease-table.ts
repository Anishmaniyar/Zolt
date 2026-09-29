import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('leases', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    execution_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
    },
    worker_id: {
      type: 'text',
      notNull: true,
    },
    lease_expires_at: {
      type: 'timestamp with time zone',
      notNull: true,
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

  pgm.addConstraint('leases', 'leases_execution_id_fkey', {
    foreignKeys: {
      columns: 'execution_id',
      references: 'executions(id)',
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('leases');
}
