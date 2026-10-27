// API lifecycle integration test.
//
// How it works:
//   supertest drives the real Express app (createApp), the real controllers/
//   services/repositories, and the real Postgres connection. No BullMQ worker
//   is started; after creating a job we call the scheduler's due-job
//   transaction directly to move it from SCHEDULED to QUEUED and write its
//   pending outbox row. This isolates HTTP + persistence behavior from Redis.
//
// Covered:
//   T1  create -> fetch -> executions -> scheduler claim -> cancellation guard,
//   validation errors, not-found errors, and the known lack of submission-level
//   idempotency (two identical POSTs create two logical jobs).

import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app/app.js';
import {
  closeTestPool,
  countIdempotencyByKey,
  countJobsByTitle,
  deleteJobCascade,
  getExecutions,
  getIdempotency,
  getJob,
  getOutboxForJob,
} from './helpers/db.js';
import { claimDueJobs } from './helpers/scheduler.js';

const app = createApp();

describe('API job lifecycle', () => {
  const createdJobIds: string[] = [];

  afterEach(async () => {
    for (const jobId of createdJobIds.splice(0)) {
      await deleteJobCascade(jobId);
    }
  });

  afterAll(async () => {
    await closeTestPool();
  });

  const createImmediateJob = async (title = `API Lifecycle ${crypto.randomUUID()}`) => {
    const response = await request(app).post('/api/v1/jobs').send({
      title,
      type: 'SEND_EMAIL',
      schedule_type: 'IMMEDIATE',
      payload: { to: 'test@example.com' },
      max_attempts: 2,
    });

    expect(response.status).toBe(201);

    const jobId = response.body.data.id as string;
    createdJobIds.push(jobId);

    return { response, jobId };
  };

  it('creates a job, serves it, reports no executions, then claims it for the queue', async () => {
    const { response, jobId } = await createImmediateJob();

    expect(response.body).toMatchObject({
      status: 'success',
      data: {
        id: jobId,
        type: 'SEND_EMAIL',
        schedule_type: 'IMMEDIATE',
        status: 'SCHEDULED',
      },
    });

    expect((await getJob(jobId)).status).toBe('SCHEDULED');
    expect((await getIdempotency(jobId)).status).toBe('PENDING');

    const getResponse = await request(app).get(`/api/v1/jobs/${jobId}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.id).toBe(jobId);

    const executionResponse = await request(app).get(`/api/v1/jobs/${jobId}/executions`);
    expect(executionResponse.status).toBe(200);
    expect(executionResponse.body.data).toEqual([]);

    // Scheduler due-job transaction: SCHEDULED -> QUEUED + outbox(job_id).
    const claimed = await claimDueJobs();
    expect(claimed.map((job) => job.id)).toContain(jobId);

    expect((await getJob(jobId)).status).toBe('QUEUED');
    expect((await getOutboxForJob(jobId))?.status).toBe('PENDING');

    // Once QUEUED, the API refuses cancellation.
    const cancelResponse = await request(app).post(`/api/v1/jobs/${jobId}/cancel`);
    expect(cancelResponse.status).toBe(409);
  });

  it('cancels a SCHEDULED job and reports it through the API and the database', async () => {
    const { jobId } = await createImmediateJob();

    const cancelResponse = await request(app).post(`/api/v1/jobs/${jobId}/cancel`);
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.data).toMatchObject({ id: jobId, status: 'CANCELLED' });

    expect((await getJob(jobId)).status).toBe('CANCELLED');

    // A cancelled job is not picked up by the scheduler.
    const claimed = await claimDueJobs();
    expect(claimed.map((job) => job.id)).not.toContain(jobId);
    expect(await getExecutions(jobId)).toHaveLength(0);
  });

  it('rejects invalid schedule/payload combinations', async () => {
    const missingRunAt = await request(app).post('/api/v1/jobs').send({
      title: 'Missing run_at for ONCE',
      type: 'SEND_EMAIL',
      schedule_type: 'ONCE',
      max_attempts: 1,
    });

    expect(missingRunAt.status).toBe(400);

    const runAtOnImmediate = await request(app).post('/api/v1/jobs').send({
      title: 'run_at on IMMEDIATE',
      type: 'SEND_EMAIL',
      schedule_type: 'IMMEDIATE',
      run_at: new Date(Date.now() + 60_000).toISOString(),
      max_attempts: 1,
    });

    expect(runAtOnImmediate.status).toBe(400);
  });

  it('returns 404 for unknown job and execution lookups', async () => {
    const missingId = crypto.randomUUID();

    expect((await request(app).get(`/api/v1/jobs/${missingId}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/jobs/${missingId}/executions`)).status).toBe(404);
    expect((await request(app).post(`/api/v1/jobs/${missingId}/cancel`)).status).toBe(404);
  });

  it('still creates separate jobs when no Idempotency-Key is supplied', async () => {
    const title = `Unkeyed Submission ${crypto.randomUUID()}`;
    const body = {
      title,
      type: 'SEND_EMAIL',
      schedule_type: 'IMMEDIATE' as const,
      max_attempts: 1,
    };

    const first = await request(app).post('/api/v1/jobs').send(body);
    const second = await request(app).post('/api/v1/jobs').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    createdJobIds.push(first.body.data.id, second.body.data.id);

    // Without a key there is nothing to deduplicate on: two submissions are two
    // jobs. The client opts into exactly-once by sending the header.
    expect(first.body.data.id).not.toBe(second.body.data.id);
    expect(await countJobsByTitle(title)).toBe(2);
  });

  it('returns the first job when the same Idempotency-Key is submitted again', async () => {
    const title = `Keyed Submission ${crypto.randomUUID()}`;
    const idempotencyKey = crypto.randomUUID();
    const body = {
      title,
      type: 'SEND_EMAIL',
      schedule_type: 'IMMEDIATE' as const,
      max_attempts: 1,
    };

    const first = await request(app)
      .post('/api/v1/jobs')
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    const second = await request(app)
      .post('/api/v1/jobs')
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body.deduplicated).toBe(false);

    // A replay is answered with the stored job, not a second job.
    expect(second.status).toBe(200);
    expect(second.body.deduplicated).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);

    createdJobIds.push(first.body.data.id);

    expect(await countJobsByTitle(title)).toBe(1);
    expect(await countIdempotencyByKey(idempotencyKey)).toBe(1);
  });

  it('converges on one job when the same Idempotency-Key is submitted concurrently', async () => {
    const title = `Concurrent Keyed Submission ${crypto.randomUUID()}`;
    const idempotencyKey = crypto.randomUUID();
    const body = {
      title,
      type: 'SEND_EMAIL',
      schedule_type: 'IMMEDIATE' as const,
      max_attempts: 1,
    };

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/api/v1/jobs').set('Idempotency-Key', idempotencyKey).send(body),
      ),
    );

    const jobIds = [...new Set(responses.map((response) => response.body.data.id as string))];

    expect(jobIds).toHaveLength(1);
    createdJobIds.push(jobIds[0]!);

    // Exactly one submission created the job; the rest were replay responses.
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(4);
    expect(await countJobsByTitle(title)).toBe(1);
    expect(await countIdempotencyByKey(idempotencyKey)).toBe(1);
  });

  it('rejects an Idempotency-Key that is longer than 200 characters', async () => {
    const response = await request(app)
      .post('/api/v1/jobs')
      .set('Idempotency-Key', 'x'.repeat(201))
      .send({
        title: `Invalid Key ${crypto.randomUUID()}`,
        type: 'SEND_EMAIL',
        schedule_type: 'IMMEDIATE',
        max_attempts: 1,
      });

    expect(response.status).toBe(400);
  });
});
