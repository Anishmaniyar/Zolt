import { z } from 'zod';

export const createJobSchema = z.object({
  body: z
    .object({
      title: z.string().min(10).max(255),

      type: z.enum(['SEND_EMAIL', 'CREATE_CAMPAIGN']),

      schedule_type: z.enum(['IMMEDIATE', 'ONCE']),

      payload: z.record(z.string(), z.unknown()).optional(),

      run_at: z.string().optional(),

      max_attempts: z.number().int().min(1).default(3),
    })
    .superRefine((data, ctx) => {
      if (data.schedule_type === 'ONCE' && !data.run_at) {
        ctx.addIssue({
          code: 'custom',
          path: ['run_at'],
          message: 'run_at is required for ONCE jobs',
        });
      }

      if (data.schedule_type === 'IMMEDIATE' && data.run_at) {
        ctx.addIssue({
          code: 'custom',
          path: ['run_at'],
          message: 'run_at must not be provided for IMMEDIATE jobs',
        });
      }
    }),
});

export const getJobByIdSchema = z.object({
  params: z.object({
    id: z.uuid(),
  }),
});

export const getJobsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),

    limit: z.coerce.number().int().min(1).max(100).default(20),

    status: z.enum(['SCHEDULED', 'QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),

    sortBy: z.enum(['createdAt', 'updatedAt', 'runAt']).default('createdAt'),

    order: z.enum(['asc', 'desc']).default('desc'),
  }),
});

export const cancelJobByIdSchema = z.object({
  params: z.object({
    id: z.uuid(),
  }),
});
