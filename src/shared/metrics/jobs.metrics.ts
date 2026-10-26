import { Counter } from 'prom-client';
import { register } from './registry.js';

export const jobsTotal = new Counter({
  name: 'zolt_jobs_created_total',
  help: 'Total number of jobs successfully created',
  labelNames: ['type', 'schedule_type'] as const,
  registers: [register],
});

export const jobsTotalFinalState = new Counter({
  name: 'zolt_jobs_final_total',
  help: 'Total number of jobs reached in terminal(final) state',
  labelNames: ['type', 'schedule_type', 'status'] as const,
  registers: [register],
});
