import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('idempotency_records', {
    processing_started_at: {
      type: 'timestamp with time zone',
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn('idempotency_records', 'processing_started_at');
}
