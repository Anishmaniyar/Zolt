import { retryConfig } from '../config/retry.config.js';

export function calculateRetryAt(attempt: number) {
  // Exponential backoff
  const exponentialDelay = retryConfig.baseDelay * retryConfig.exponentialBase ** (attempt - 1);

  // Prevent delay from exceeding the maximum
  const cappedDelay = Math.min(exponentialDelay, retryConfig.maxDelay);

  // Full jitter: random delay between 0 and cappedDelay
  const jitter = Math.random() * cappedDelay * retryConfig.jitterFactor;

  const finalDelay = cappedDelay + jitter;

  return new Date(Date.now() + finalDelay);
}
