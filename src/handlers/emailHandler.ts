import { logger } from '../shared/logger/logger.js';
import { getPayloadKeys, simulateHandlerBehaviour } from './handlerBehaviour.js';
import { config } from '../config/env.config.js';

export const emailHandler = async (payload: any, signal: AbortSignal, executionId: string) => {
  logger.info(
    { event: 'handler.started', handler: 'SEND_EMAIL', executionId, payloadKeys: getPayloadKeys(payload) },
    'Send Email handler started',
  );

  await simulateHandlerBehaviour({
    normalDurationMs: 1_000,
    slowDurationMs: 20_000,
    executionId,
    signal,
    timeoutMs: config.execution.timeout,
  });

  logger.info(
    { event: 'handler.completed', handler: 'SEND_EMAIL', executionId },
    'Send Email handler completed',
  );
};
