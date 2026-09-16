import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  REDIS_URL: z.url(),

  DATABASE_URL: z.url(),
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
});
