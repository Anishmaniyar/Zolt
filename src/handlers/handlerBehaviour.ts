import { logger } from '../shared/logger/logger.js';

type SimulationOutcome = 'SUCCESS' | 'SLOW_SUCCESS' | 'FAILURE' | 'TIMEOUT';

interface SimulationOptions {
  normalDurationMs: number;
  slowDurationMs: number;
  executionId: string;
  signal: AbortSignal;
  timeoutMs: number;
}

const selectOutcome = (): SimulationOutcome => {
  const random = Math.random();

  if (random < 0.6) return 'SUCCESS';
  if (random < 0.8) return 'SLOW_SUCCESS';
  if (random < 0.9) return 'FAILURE';

  return 'TIMEOUT';
};

const delay = (durationMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Execution Aborted'));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new Error('Execution Aborted'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });

// Summarizes a job payload for safe logging: key names only, never values,
// so arbitrary user data (emails, tokens) can't leak into logs.
export const getPayloadKeys = (payload: unknown): string[] => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return Object.keys(payload);
  }

  return [];
};

export const simulateHandlerBehaviour = async ({  normalDurationMs,
  slowDurationMs,
  executionId,
  signal,
  timeoutMs,
}: SimulationOptions): Promise<void> => {
  const outcome = selectOutcome();

  logger.info(
    { event: 'handler.simulation.outcome_selected', executionId, outcome },
    'Handler simulation outcome selected',
  );

  switch (outcome) {
    case 'SUCCESS':
      await delay(normalDurationMs, signal);
      return;

    case 'SLOW_SUCCESS':
      await delay(slowDurationMs, signal);
      return;

    case 'FAILURE':
      throw new Error('Simulated transient handler failure');

    case 'TIMEOUT':
      await delay(timeoutMs + 5_000, signal);
      return;
  }
};
