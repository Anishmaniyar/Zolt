import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.dropConstraint('executions', 'executions_status_check');

  pgm.addConstraint('executions', 'executions_status_check', {
    check: "status IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT')",
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropConstraint('executions', 'executions_status_check');

  pgm.addConstraint('executions', 'executions_status_check', {
    check: "status IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')",
  });
}
