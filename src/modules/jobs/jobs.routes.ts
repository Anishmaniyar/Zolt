import { Router } from 'express';
import { validateRequest } from '../../middleware/validate.middleware.js';
import * as JobSchema from './job.schema.js';
import * as JobController from './jobs.controller.js';

const jobRouter = Router();

jobRouter.post(
  '/jobs',
  validateRequest(JobSchema.createJobSchema),
  JobController.createJobController,
);

jobRouter.get(
  '/jobs/:id',
  validateRequest(JobSchema.getJobByIdSchema),
  JobController.getJobByIdController,
);

jobRouter.get('/jobs', validateRequest(JobSchema.getJobsSchema), JobController.getJobsController);

jobRouter.post(
  '/jobs/:id/cancel',
  validateRequest(JobSchema.cancelJobByIdSchema),
  JobController.cancelJobController,
);

export default jobRouter;
