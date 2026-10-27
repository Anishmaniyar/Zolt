// Live-runtime detection for the integration suite.
//
// All test files share the database configured in .env and the single BullMQ
// `jobs` queue. When a development API/scheduler/worker is running at the same
// time, the scheduler claims due fixtures on its own 15-second tick and the
// worker consumes the rows it publishes. Tests that need exclusive claim
// rights cannot be trusted in that situation, so they skip themselves with a
// clear reason instead of producing random failures.
//
// Detection is done through the per-role metrics ports, which every process
// starts at boot:
//   API        9464 (API_METRICS_PORT)
//   scheduler  9465 (SCHEDULER_METRICS_PORT)
//   worker     9466 (WORKER_METRICS_PORT)
//
// The check runs once at import time (top-level await), so test collection can
// use `describe.skipIf(!exclusiveRuntime)`.

import { config } from '../../src/config/env.config.js';

export interface LiveRuntime {
  api: boolean;
  scheduler: boolean;
  worker: boolean;
}

async function portAnswers(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
      signal: AbortSignal.timeout(1_500),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function detectLiveRuntime(): Promise<LiveRuntime> {
  const [api, scheduler, worker] = await Promise.all([
    portAnswers(config.ports.api),
    portAnswers(config.ports.scheduler),
    portAnswers(config.ports.worker),
  ]);

  return { api, scheduler, worker };
}

export const liveRuntime: LiveRuntime = await detectLiveRuntime();

export const liveRuntimeDescription = Object.entries(liveRuntime)
  .filter(([, running]) => running)
  .map(([role]) => role)
  .join(', ');

// Set ZOLT_TEST_EXCLUSIVE=1 to run these suites anyway. They may then fail
// spuriously, because the live scheduler claims the same due rows.
const forced = process.env.ZOLT_TEST_EXCLUSIVE === '1';

// True when no development process is sharing the database and queue.
export const exclusiveRuntime = forced || liveRuntimeDescription.length === 0;

export const LIVE_RUNTIME_SKIP_REASON =
  `live development process(es) detected (${liveRuntimeDescription}); ` +
  'this suite needs exclusive claim rights over due jobs/executions. ' +
  'Stop pnpm dev:api, pnpm dev:scheduler and pnpm dev:worker, then rerun.';
