import { Gauge } from 'prom-client';
import { register } from './registry.js';

export const workerActiveExecutions = new Gauge({
  name: 'zolt_worker_active_executions',
  help: 'Number of executions currently held by this worker process',
  registers: [register],
});
