import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

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
});
