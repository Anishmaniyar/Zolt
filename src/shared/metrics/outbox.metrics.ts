import { Gauge } from 'prom-client';
import { register } from './registry.js';

export const outboxPending = new Gauge({
  name: 'zolt_outbox_pending',
  help: 'Number of outbox rows waiting to be published',
  registers: [register],
});

export const outboxOldestPendingAgeSeconds = new Gauge({
  name: 'zolt_outbox_oldest_pending_age_seconds',
  help: 'Age in seconds of the oldest pending outbox row (0 when none are pending)',
  registers: [register],
});
