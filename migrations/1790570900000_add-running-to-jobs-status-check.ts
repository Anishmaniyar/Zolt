import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  // JobRepository.startJob() transitions QUEUED -> RUNNING, but the
  // original check constraint did not list RUNNING, so every execution
  // failed with a check-constraint violation before reaching the handler.
  pgm.dropConstraint('jobs', 'job_status_check');

  pgm.addConstraint('jobs', 'job_status_check', {
    check: "status IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')",
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropConstraint('jobs', 'job_status_check');

  pgm.addConstraint('jobs', 'job_status_check', {
    check: "status IN ('SCHEDULED', 'QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED')",
  });
}
