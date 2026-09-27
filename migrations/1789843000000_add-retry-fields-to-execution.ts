import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('executions', {
    retry_at: {
      type: 'timestamp with time zone',
    },
  });

  pgm.dropConstraint('executions', 'executions_status_check');

  pgm.addConstraint('executions', 'executions_status_check', {
    check: "status IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')",
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropConstraint('executions', 'executions_status_check');

  pgm.addConstraint('executions', 'executions_status_check', {
    check: "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')",
  });

  pgm.dropColumn('executions', 'retry_at');
}
