import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  REDIS_URL: z.url(),

  DATABASE_URL: z.url(),

  WORKER_CONCURRENCY: z.coerce.number().min(1).default(5),

  WORKER_ID: z.string().default('unknow-worker'),

  GLOBAL_CONCURRENCY: z.coerce.number().min(1).default(6),

  SCHEDULER_POOL_INTERVAL: z.coerce.number().min(5000).default(15000),

  SCHEDULER_BATCH_SIZE: z.coerce.number().min(5).default(5),

  SCHEDULER_ID: z.string().default('unknown-scheduler'),
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
});
