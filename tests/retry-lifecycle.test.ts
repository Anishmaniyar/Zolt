// Retry lifecycle integration test.
//
// How it works:
//   A first attempt is failed by a mocked handler. The execution service
//   schedules attempt 2 as SCHEDULED. We then simulate the scheduler making
//   the retry due, claiming it, and the worker running it. The second handler
//   call succeeds.
//
// Covered:
//   T3  failed attempt -> SCHEDULED retry -> scheduler claim/outbox ->
//   successful terminal completion, with exactly two handler invocations.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { handlerRegistry } from '../src/handlers/handler.registry.js';
import { executeExistingExecution } from '../src/modules/executions/execution.service.js';
import {
  closeTestPool,
  deleteJobCascade,
  getExecutions,
  getIdempotency,
  getJob,
  getOutboxForExecution,
} from './helpers/db.js';
import { createExecutableJob, makeRetryDue } from './helpers/fixtures.js';
import { claimDueExecutions } from './helpers/scheduler.js';

describe('Retry lifecycle', () => {
  const createdJobIds: string[] = [];

  afterEach(async () => {
    for (const jobId of createdJobIds.splice(0)) {
      await deleteJobCascade(jobId);
    }

    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('schedules, claims, and completes a second attempt after the first handler failure', async () => {
    const { job, execution } = await createExecutableJob({
      title: 'Retry Lifecycle',
      maxAttempts: 2,
    });
    createdJobIds.push(job.id);

    const handler = vi
      .spyOn(handlerRegistry, 'SEND_EMAIL')
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce(undefined);

    expect(await executeExistingExecution(execution.id, 'worker-a')).toBe(false);

    let executions = await getExecutions(job.id);
    expect(executions).toHaveLength(2);
    expect(executions[0]).toMatchObject({ attempt: 1, status: 'FAILED' });
    expect(executions[1]).toMatchObject({ attempt: 2, status: 'SCHEDULED' });
    expect((await getIdempotency(job.id)).status).toBe('PENDING');
    expect((await getJob(job.id)).status).toBe('RUNNING');

    const retry = executions[1]!;
    await makeRetryDue(retry.id);

    const claimed = await claimDueExecutions();
    expect(claimed.map((item) => item.id)).toContain(retry.id);
    expect((await getOutboxForExecution(retry.id))?.status).toBe('PENDING');

    executions = await getExecutions(job.id);
    expect(executions[1]!.status).toBe('QUEUED');

    expect(await executeExistingExecution(retry.id, 'worker-b')).toBe(true);

    expect(handler).toHaveBeenCalledTimes(2);

    executions = await getExecutions(job.id);
    expect(executions[0]!.status).toBe('FAILED');
    expect(executions[1]!.status).toBe('COMPLETED');

    expect((await getJob(job.id)).status).toBe('COMPLETED');
    expect((await getIdempotency(job.id)).status).toBe('COMPLETED');
  });
});
