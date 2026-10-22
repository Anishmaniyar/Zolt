import type { Request, Response } from 'express';
import { register } from './http.metrics.js';

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}
