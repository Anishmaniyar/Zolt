import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  // Existing rows get backfilled with the default (PostgreSQL fills
  // ADD COLUMN ... NOT NULL DEFAULT ... for existing rows).
  pgm.addColumns('idempotency_records', {
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

  // The scheduler polls PROCESSING + processing_started_at every tick.
  pgm.createIndex('idempotency_records', ['status', 'processing_started_at']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('idempotency_records', ['status', 'processing_started_at']);
  pgm.dropColumns('idempotency_records', ['created_at', 'updated_at']);
}
