import { Request, Response, NextFunction } from 'express';

// Wraps an async Express handler so rejected promises are forwarded to Express error handling.
const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any> | any,
) => {
  // Runs the wrapped handler and forwards any rejection to the next error middleware.
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default asyncHandler;
