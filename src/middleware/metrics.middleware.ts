import type { RequestHandler } from 'express';

import {
  httpRequestsTotal,
  httpRequestsInFlight,
  httpRequestsDurationSeconds,
} from '../shared/metrics/http.metrics.js';

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  if (req.path === '/metrics') {
    next();
    return;
  }

  const endTimer = httpRequestsDurationSeconds.startTimer();
  httpRequestsInFlight.inc();

  let finalized = false;

  const finalize = () => {
    if (finalized) return;
    finalized = true;

    httpRequestsInFlight.dec();

    // record only requests whose responses completed successfully
    if (!res.writableFinished) return;

    const routePath = req.route?.path;

    const route = typeof routePath === 'string' ? routePath : 'unmatched';

    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    endTimer(labels);
  };

  res.once('finish', finalize);
  res.once('close', finalize);

  next();
};
