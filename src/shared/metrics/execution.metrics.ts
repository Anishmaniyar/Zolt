import { Counter, Histogram } from 'prom-client';
import { register } from './registry.js';

export const executionDurationSeconds = new Histogram({
  name: 'zolt_execution_duration_seconds',
  help: 'Duration of a terminal job execution attempt in seconds',
  labelNames: ['type', 'status'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

export const executionRetriesTotal = new Counter({
  name: 'zolt_execution_retries_total',
  help: 'Total number of retry executions scheduled',
  labelNames: ['type'] as const,
  registers: [register],
});

// Records one terminal attempt using the database timestamps.
// Missing timestamps (for example a never-started execution) are skipped
// instead of producing a misleading duration.
export function observeExecutionDuration(
  type: string,
  status: string,
  startedAt: Date | string | null,
  completedAt: Date | string | null,
) {
  if (!startedAt || !completedAt) return;

  const seconds = (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000;

  if (!Number.isFinite(seconds) || seconds < 0) return;

  executionDurationSeconds.labels(type, status).observe(seconds);
}

export function recordExecutionRetry(type: string) {
  executionRetriesTotal.labels(type).inc();
}
