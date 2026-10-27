// Scheduler tick overlap guard (M6).
//
// How it works:
//   `runSchedulerTick` is the exact pass the interval timer invokes. Two calls
//   started in the same batch must not run a pass each: the first one owns the
//   tick and the second returns false. The guard flag is process-local, so the
//   result does not depend on whether development processes are running.
//
// Covered:
//   M6  setInterval cannot stack ticks on top of a still-running tick.

import { afterAll, describe, expect, it } from 'vitest';

import { runSchedulerTick } from '../src/modules/scheduler/scheduler.service.js';
import { closeTestPool } from './helpers/db.js';

describe('Scheduler tick overlap guard', () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it('skips a tick that starts while a previous tick is still running', async () => {
    const [first, second] = await Promise.all([runSchedulerTick(), runSchedulerTick()]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((ran) => ran === false)).toHaveLength(1);
  });

  it('runs subsequent ticks once the previous tick finished', async () => {
    expect(await runSchedulerTick()).toBe(true);
    expect(await runSchedulerTick()).toBe(true);
  });
});
