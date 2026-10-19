import type { Request, Response } from 'express';

// Returns the API error shape for requests that match no registered route.
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    status: 'fail',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
};
