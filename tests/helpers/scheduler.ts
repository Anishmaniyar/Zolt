// Scheduler pass helpers.
//
// The production scheduler keeps `processStaleIdempotency`,
// `processExpiredLeases`, and `runTick` private. These helpers call the same
// repositories/services in the same order so a test can reproduce a real tick
// without exporting test-only internals or waiting for the 15-second timer.
// The order in `runRecoveryPass` is significant: the real tick resets stale
// idempotency before it recovers expired leases.

import { config } from '../../src/config/env.config.js';
import * as ExecutionService from '../../src/modules/executions/execution.service.js';
import * as IdempotencyRepository from '../../src/modules/idempotency/idempotency.repository.js';
import * as LeaseRepository from '../../src/modules/leases/leases.repository.js';
import * as OutboxRepository from '../../src/modules/outbox/outbox.repository.js';
import * as SchedulerRepository from '../../src/modules/scheduler/scheduler.repository.js';

export async function resetStaleIdempotency(
  timeoutMs: number = config.idempotency.processingTimeout,
): Promise<number> {
  const staleRecords = await IdempotencyRepository.getStaleProcessingRecords(timeoutMs);
  let resetCount = 0;

  for (const record of staleRecords) {
    resetCount += await IdempotencyRepository.resetStaleProcessingRecord(record.id, timeoutMs);
  }

  return resetCount;
}

export interface RecoveryAttempt {
  executionId: string;
  workerId: string;
  error?: unknown;
}

// Mirrors processExpiredLeases: each execution recovery is isolated so one
// failure does not stop the rest of the batch.
export async function recoverExpiredLeases(): Promise<RecoveryAttempt[]> {
  const expiredLeases = await LeaseRepository.findExpiredLeases();
  const attempts: RecoveryAttempt[] = [];

  for (const lease of expiredLeases) {
    try {
      await ExecutionService.recoverExpiredExecution(lease.execution_id);
      attempts.push({ executionId: lease.execution_id, workerId: lease.worker_id });
    } catch (error) {
      attempts.push({ executionId: lease.execution_id, workerId: lease.worker_id, error });
    }
  }

  return attempts;
}

// Reproduces the order in the real scheduler tick: stale idempotency first,
// then expired leases.
export async function runRecoveryPass(): Promise<{
  staleResetCount: number;
  recoveryAttempts: RecoveryAttempt[];
}> {
  const staleResetCount = await resetStaleIdempotency();
  const recoveryAttempts = await recoverExpiredLeases();

  return { staleResetCount, recoveryAttempts };
}

export function claimDueJobs(batch: number = config.scheduler.batch) {
  return SchedulerRepository.processJobTransaction(batch);
}

export function claimDueExecutions(batch: number = config.scheduler.batch) {
  return SchedulerRepository.processExecutionTransactions(batch);
}

export function publishPendingOutbox(batch: number = config.scheduler.batch) {
  return OutboxRepository.claimPendingOutbox(batch);
}
