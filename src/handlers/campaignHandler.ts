import { config } from '../config/env.config.js';
import { logger } from '../shared/logger/logger.js';
import { getPayloadKeys, simulateHandlerBehaviour } from './handlerBehaviour.js';

export const campaignHandler = async (payload: any, signal: AbortSignal, executionId: string) => {
  logger.info(
    {
      event: 'handler.started',
      handler: 'CREATE_CAMPAIGN',
      executionId,
      payloadKeys: getPayloadKeys(payload),
    },
    'Campaign Handler started',
  );

  await simulateHandlerBehaviour({
    normalDurationMs: 5_000,
    slowDurationMs: 15_000,
    executionId,
    signal,
    timeoutMs: config.execution.timeout,
  });

  logger.info(
    { event: 'handler.completed', handler: 'CREATE_CAMPAIGN', executionId },
    'Campaign handler completed',
  );
};
