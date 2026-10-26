import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),

    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    API_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),

    SCHEDULER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9465),

    WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9466),

    REDIS_URL: z.url(),

    DATABASE_URL: z.url(),

    WORKER_CONCURRENCY: z.coerce.number().min(1).default(5),

    WORKER_ID: z.string().default('unknown-worker'),

    GLOBAL_CONCURRENCY: z.coerce.number().min(1).default(6),

    SCHEDULER_POOL_INTERVAL: z.coerce.number().min(5000).default(15000),

    SCHEDULER_BATCH_SIZE: z.coerce.number().min(5).default(5),

    SCHEDULER_ID: z.string().default('unknown-scheduler'),

    IDEMPOTENCY_PROCESSING_TIMEOUT_MS: z.coerce.number(),

    EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive(),

    LEASE_DURATION_MS: z.coerce.number().int().positive().default(30000),

    HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10000),

    QUEUE_RECONCILIATION_INTERVAL_MS: z.coerce.number().min(5000).default(120000),

    QUEUE_RECONCILIATION_BATCH_SIZE: z.coerce.number().min(5).default(50),

    QUEUE_RECONCILIATION_MIN_AGE_MS: z.coerce.number().min(5000).default(30000),
  })
  .superRefine((data, ctx) => {
    if (data.API_METRICS_PORT === data.SCHEDULER_METRICS_PORT) {
      ctx.addIssue({
        code: 'custom',
        message: 'API_METRICS_PORT and SCHEDULER_METRICS_PORT cannot be the same',
        path: ['SCHEDULER_METRICS_PORT'],
      });
    }
    if (data.API_METRICS_PORT === data.WORKER_METRICS_PORT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'API_METRICS_PORT and WORKER_METRICS_PORT cannot be the same',
        path: ['WORKER_METRICS_PORT'],
      });
    }

    if (data.SCHEDULER_METRICS_PORT === data.WORKER_METRICS_PORT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SCHEDULER_METRICS_PORT and WORKER_METRICS_PORT cannot be the same',
        path: ['WORKER_METRICS_PORT'],
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(z.prettifyError(parsedEnv.error));

  process.exit(1);
}

const env = parsedEnv.data;

export const config = Object.freeze({
  env: env.NODE_ENV,

  level: env.LOG_LEVEL,

  server: Object.freeze({
    port: env.PORT,
  }),

  redis: Object.freeze({
    url: env.REDIS_URL,
  }),

  database: Object.freeze({
    url: env.DATABASE_URL,
  }),

  worker: Object.freeze({
    concurrency: env.WORKER_CONCURRENCY,
    id: env.WORKER_ID,
    globalConcurrency: env.GLOBAL_CONCURRENCY,
  }),

  scheduler: Object.freeze({
    intervalSize: env.SCHEDULER_POOL_INTERVAL,
    batch: env.SCHEDULER_BATCH_SIZE,
    id: env.SCHEDULER_ID,
  }),

  idempotemcy: Object.freeze({
    processingTimeout: env.IDEMPOTENCY_PROCESSING_TIMEOUT_MS,
  }),

  execution: Object.freeze({
    timeout: env.EXECUTION_TIMEOUT_MS,
  }),

  // Heartbeat must run more often than the lease expires so a live
  // worker renews several times before expiry.
  lease: Object.freeze({
    duration: env.LEASE_DURATION_MS,
    heartbeatInterval: env.HEARTBEAT_INTERVAL_MS,
  }),

  queueReconciliation: Object.freeze({
    interval: env.QUEUE_RECONCILIATION_INTERVAL_MS,
    batchSize: env.QUEUE_RECONCILIATION_BATCH_SIZE,
    minAge: env.QUEUE_RECONCILIATION_MIN_AGE_MS,
  }),

  ports: Object.freeze({
    api: env.API_METRICS_PORT,
    scheduler: env.SCHEDULER_METRICS_PORT,
    worker: env.WORKER_METRICS_PORT,
  }),
});
