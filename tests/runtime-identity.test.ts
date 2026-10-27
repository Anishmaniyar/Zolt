// Process identity and metrics-server tests (H5).
//
// How it works:
//   No database rows and no queue are involved. The first test checks the
//   configuration defaults that two workers started from the same .env would
//   otherwise share; the second starts a real metrics server twice on the same
//   port to prove a collision is reported instead of killing the process.
//
// Covered:
//   H5  default WORKER_ID/SCHEDULER_ID are unique per process, and an
//       EADDRINUSE on the metrics port no longer raises an unhandled 'error'
//       event.

import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterAll, describe, expect, it } from 'vitest';

import { config } from '../src/config/env.config.js';
import { startMetricsServer } from '../src/shared/metrics/metrics.server.js';
import { closeTestPool } from './helpers/db.js';

describe('Process identity', () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it('defaults the worker and scheduler identity to a per-process value', () => {
    // The .env does not set WORKER_ID or SCHEDULER_ID, so these are defaults.
    expect(config.worker.id).not.toBe('unknown-worker');
    expect(config.scheduler.id).not.toBe('unknown-scheduler');

    // Pid-scoped means two workers started from the same .env cannot renew
    // each other's leases, and their log lines stay distinguishable.
    expect(config.worker.id).toContain(String(process.pid));
    expect(config.scheduler.id).toContain(String(process.pid));
    expect(config.worker.id).not.toBe(config.scheduler.id);
  });

  it('reports a metrics port collision instead of crashing the process', async () => {
    const first = startMetricsServer(0);

    await once(first, 'listening');

    const { port } = first.address() as AddressInfo;
    expect(port).toBeGreaterThan(0);

    const second = startMetricsServer(port);

    // With an unhandled 'error' event this would take the whole process down.
    const [error] = await once(second, 'error');
    expect((error as NodeJS.ErrnoException).code).toBe('EADDRINUSE');

    await new Promise<void>((resolve) => first.close(() => resolve()));
    await new Promise<void>((resolve) => second.close(() => resolve()));
  });
});
