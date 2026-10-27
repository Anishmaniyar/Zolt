import asyncHandler from '../../utils/asyncHandler.js';
import { Request, Response, NextFunction } from 'express';
import * as JobService from './jobs.service.js';
import { GetJobsQuery } from './jobs.types.js';
import * as ExecutionService from '../executions/execution.service.js';
import { logger } from '../../shared/logger/logger.js';

// Handles POST /jobs by creating a new job.
// An optional client Idempotency-Key makes the submission replay-safe: the same
// key returns the job created by the first request (200) instead of a duplicate.
export const createJobController = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const idempotencyKey = req.get('Idempotency-Key');

    const { job, deduplicated } = await JobService.createJobService(req.body, {
      idempotencyKey,
    });

    logger.info(
      {
        event: deduplicated ? 'job.deduplicated' : 'job.created',
        requestId: res.locals.requestId,
        jobId: job.id,
        type: job.type,
        scheduleType: job.schedule_type,
        maxAttempts: job.max_attempts,
        status: job.status,
        idempotencyKeyProvided: idempotencyKey !== undefined,
      },
      deduplicated ? 'JOB DEDUPLICATED BY IDEMPOTENCY KEY' : 'JOB CREATED',
    );

    return res.status(deduplicated ? 200 : 201).json({
      message: deduplicated ? 'Job already exists for this Idempotency-Key' : 'Job created successfully',
      status: 'success',
      deduplicated,
      data: job,
    });
  },
);

// Handles GET /jobs/:id by returning a single job.
export const getJobByIdController = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { id } = req.params;

    const result = await JobService.getJobByIdService({ id: id as string });

    return res.status(200).json({
      message: 'Job data fetched successfully',
      status: 'success',
      data: result,
    });
  },
);

// Handles GET /jobs by returning filtered and paginated jobs.
export const getJobsController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as GetJobsQuery;

  const result = await JobService.getJobsService(query);

  return res.status(200).json({
    message: 'Jobs data fetched successfully',
    status: 'success',
    data: result.jobs,
    pagination: result.pagination,
  });
});

// Handles POST /jobs/:id/cancel by cancelling a scheduled job.
export const cancelJobController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await JobService.cancelJobService({ id: id as string });

  logger.info(
    {
      event: 'job.cancelled',
      requestId: res.locals.requestId,
      jobId: result.id,
      type: result.type,
      scheduleType: result.schedule_type,
      maxAttempts: result.max_attempts,
    },
    'JOB CANCELLED',
  );

  return res.status(200).json({
    message: 'Job cancelled successfully',
    status: 'success',
    data: result,
  });
});

// Handles GET /jobs/:id/executions by returning all executions of a job.
export const getJobExecutionsController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await ExecutionService.getJobExecutionsService({ id: id as string });

  return res.status(200).json({
    message: 'Job executions data fetched successfully',
    status: 'success',
    data: result,
  });
});
