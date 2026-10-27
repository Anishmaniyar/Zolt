import { defineConfig } from 'vitest/config';

// Tests run serially because several suites assert on process-global Prometheus
// counters/gauges and on shared Postgres tables. Running files in parallel can
// make one suite claim another suite's due jobs or observe another suite's
// metric increments. Each file still gets its own worker process, matching the
// existing `pool.end()` cleanup pattern in the test files.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
