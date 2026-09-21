import asyncHandler from '../../utils/asyncHandler.js';
import { Request, Response, NextFunction } from 'express';
import * as JobService from './jobs.service.js';
import { string } from 'zod';
import { GetJobsQuery } from './jobs.types.js';

export const createJobController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const result = await JobService.createJobService(req.body);

    return res.status(201).json({
      message: 'Job created successfully',
      status: 'success',
      data: result,
    });
  },
);

export const getJobByIdController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const result = await JobService.getJobByIdService({ id: id as string });

    return res.status(200).json({
      message: 'Job data fetched successfully',
      status: 'success',
      data: result,
    });
  },
);

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

export const cancelJobController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await JobService.cancelJobService({ id: id as string });

  return res.status(200).json({
    message: 'Job cancelled successfully',
    status: 'success',
    data: result,
  });
});
