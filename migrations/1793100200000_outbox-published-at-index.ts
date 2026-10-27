import type { MigrationBuilder } from 'node-pg-migrate';

// Published outbox rows are now pruned after a retention window, so the prune
// scan needs (status, published_at) rather than (status, created_at).
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('outbox', ['status', 'published_at'], {
    name: 'outbox_status_published_at_index',
    ifNotExists: true,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('outbox', ['status', 'published_at'], {
    name: 'outbox_status_published_at_index',
    ifExists: true,
  });
}
