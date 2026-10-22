import { Registry, Counter, Gauge, Histogram } from 'prom-client';

// reigstry is created this point is used to collect all the data of metrics this is only provided when we call the metrics handler to get data
export const register = new Registry();

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
