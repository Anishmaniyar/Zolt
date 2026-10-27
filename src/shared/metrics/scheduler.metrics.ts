import { Gauge, Histogram } from 'prom-client';
import { register } from './registry.js';

export const schedulerTickDurationSeconds = new Histogram({
  name: 'zolt_scheduler_tick_duration_seconds',
  help: 'Duration of one scheduler tick in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const schedulerLastTickTimestampSeconds = new Gauge({
  name: 'zolt_scheduler_last_tick_timestamp_seconds',
  help: 'Unix timestamp of the last scheduler tick',
  registers: [register],
});

export const queueJobs = new Gauge({
  name: 'zolt_queue_jobs',
  help: 'Number of BullMQ jobs by state',
  labelNames: ['state'] as const,
  registers: [register],
});
