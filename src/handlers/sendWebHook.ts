import { logger } from '../shared/logger/logger.js';
import { getPayloadKeys, simulateHandlerBehaviour } from './handlerBehaviour.js';
import { config } from '../config/env.config.js';

export const webHookHandler = async (payload: any, signal: AbortSignal, executionId: string) => {
  logger.info(
    {
      event: 'handler.started',
      handler: 'WEB_HOOK',
      executionId,
      payloadKeys: getPayloadKeys(payload),
    },
    'Web hook handler started',
  );

  await simulateHandlerBehaviour({
    normalDurationMs: 1_000,
    slowDurationMs: 20_000,
    executionId,
    signal,
    timeoutMs: config.execution.timeout,
  });

  logger.info(
    { event: 'handler.completed', handler: 'WEB_HOOK', executionId },
    'Web hook handler completed',
  );
};
