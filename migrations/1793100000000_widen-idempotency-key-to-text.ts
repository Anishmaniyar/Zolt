import type { MigrationBuilder } from 'node-pg-migrate';

// A client-supplied Idempotency-Key is an opaque string, not a UUID, so the
// unique idempotency_key column has to be wider than uuid. The unique
// constraint (and therefore the duplicate-submission guard) is preserved by
// the type change.
export function up(pgm: MigrationBuilder): void {
  pgm.alterColumn('idempotency_records', 'idempotency_key', {
    type: 'text',
    notNull: true,
  });

  pgm.addConstraint('idempotency_records', 'idempotency_key_length_check', {
    check: 'length(idempotency_key) BETWEEN 1 AND 200',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropConstraint('idempotency_records', 'idempotency_key_length_check', {
    ifExists: true,
  });

  pgm.alterColumn('idempotency_records', 'idempotency_key', {
    type: 'uuid',
    notNull: true,
    using: 'idempotency_key::uuid',
  });
}
