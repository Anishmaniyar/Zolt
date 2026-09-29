import type { MigrationBuilder } from 'node-pg-migrate';

// Worker IDs are strings (config.worker.id), and one worker holds many
// leases over time, so worker_id must be text with no unique constraint.
export function up(pgm: MigrationBuilder): void {
  pgm.dropConstraint('leases', 'leases_worker_id_key');

  pgm.alterColumn('leases', 'worker_id', {
    type: 'text',
    notNull: true,
  });

  pgm.alterColumn('leases', 'execution_id', {
    notNull: true,
  });

  pgm.alterColumn('leases', 'created_at', {
    default: pgm.func('CURRENT_TIMESTAMP'),
  });

  pgm.alterColumn('leases', 'updated_at', {
    default: pgm.func('CURRENT_TIMESTAMP'),
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.alterColumn('leases', 'worker_id', {
    type: 'integer',
  });

  pgm.addConstraint('leases', 'leases_worker_id_key', {
    unique: 'worker_id',
  });
}
