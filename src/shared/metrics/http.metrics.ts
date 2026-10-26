import { Counter, Gauge, Histogram } from 'prom-client';
import { register } from './registry.js';

export const httpRequestsTotal = new Counter({
  name: 'zolt_http_requests_total',
  help: 'Total completed HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const httpRequestsInFlight = new Gauge({
  name: 'zolt_http_requests_in_flight',
  help: 'Number of HTTP requests currently in progress',
  registers: [register],
});

export const httpRequestsDurationSeconds = new Histogram({
  name: 'zolt_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});
