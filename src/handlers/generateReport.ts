import { logger } from '../shared/logger/logger.js';
import { getPayloadKeys, simulateHandlerBehaviour } from './handlerBehaviour.js';
import { config } from '../config/env.config.js';

export const generateReportHandler = async (
  payload: any,
  signal: AbortSignal,
  executionId: string,
) => {
  logger.info(
    {
      event: 'handler.started',
      handler: 'GENERATE_REPORT',
      executionId,
      payloadKeys: getPayloadKeys(payload),
    },
    'Generate Report handler started',
  );

  await simulateHandlerBehaviour({
    normalDurationMs: 5_000,
    slowDurationMs: 30_000,
    executionId,
    signal,
    timeoutMs: config.execution.timeout,
  });

  logger.info(
    { event: 'handler.completed', handler: 'GENERATE_REPORT', executionId },
    'Generate Report handler completed',
  );
};
