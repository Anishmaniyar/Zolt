import { describe, test, expect } from 'vitest';
import { z } from 'zod';

const envSchema = z.object({
  REDIS_URL: z.url(),
});

describe('Configuration Validation', () => {
  test('should throw an error if REDIS_URL is missing', () => {
    const invalidConfig = {};

    const resut = envSchema.safeParse(invalidConfig);
    expect(resut.success).toBe(false);
  });

  test('should pass if REDIS_URL  is a valid URL', () => {
    const validConfig = { REDIS_URL: 'redis://localhost:6379' };

    const result = envSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });
});
