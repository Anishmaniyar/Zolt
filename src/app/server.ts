import { createServer, type Server } from 'node:http';

import { createApp } from './app.js';
import { config } from '../config/env.config.js';
import { closeQueue, configureQueue } from '../infrastructure/queue/queue.js';
import { closeRedis } from '../infrastructure/redis/redis.js';
import { closeDatabase } from '../infrastructure/database/pool.js';
import { logger } from '../shared/logger/logger.js';
import { startMetricsServer } from '../shared/metrics/metrics.server.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

let isShuttingDown = false;

// Closes resources owned by this process in reverse dependency order.
// The queue is closed before Redis because it uses the Redis connection.
async function closeResources(): Promise<void> {
  await closeQueue();
  await closeRedis();
  await closeDatabase();
}

// Stops accepting connections, closes active ones after a bounded wait,
// then releases queue, Redis, and Postgres connections.
async function shutdown(server: Server, signal: string, metricsServer: Server): Promise<void> {
  if (isShuttingDown) {
    logger.warn(
      { event: 'server.shutdown_ignored', signal },
      'SERVER SHUTDOWN ALREADY IN PROGRESS',
    );

    return;
  }

  isShuttingDown = true;
  metricsServer.close();

  logger.info({ event: 'server.stopping', signal }, 'SERVER STOPPING');

  const forceCloseTimer = setTimeout(() => {
    logger.warn(
      { event: 'server.force_closing_connections', signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
      'SERVER FORCE CLOSING CONNECTIONS',
    );

    server.closeAllConnections();
  }, SHUTDOWN_TIMEOUT_MS);

  forceCloseTimer.unref();

  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    await closeResources();

    logger.info({ event: 'server.stopped', signal }, 'SERVER STOPPED');

    process.exit(0);
  } catch (error) {
    logger.error({ event: 'server.shutdown_failed', signal, error }, 'SERVER SHUTDOWN FAILED');

    process.exit(1);
  } finally {
    clearTimeout(forceCloseTimer);
  }
}

// Configures the queue, starts the HTTP server, and wires graceful shutdown signals.
async function startServer(): Promise<void> {
  let server: Server | undefined;

  try {
    await configureQueue();

    const app = createApp();

    const httpServer = createServer(app);

    server = httpServer;

    const metricServer = startMetricsServer(config.ports.api);

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);

      httpServer.listen(config.server.port, () => {
        httpServer.off('error', reject);

        resolve();
      });
    });

    logger.info(
      { event: 'server.started', port: config.server.port, env: config.env },
      'SERVER STARTED',
    );

    process.on('SIGTERM', () => void shutdown(httpServer, 'SIGTERM'));
    process.on('SIGINT', () => void shutdown(httpServer, 'SIGINT'));
  } catch (error) {
    logger.error({ event: 'server.start_failed', error }, 'SERVER START FAILED');

    if (server?.listening) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }

    try {
      await closeResources();
    } catch (cleanupError) {
      logger.error(
        { event: 'server.startup_cleanup_failed', error: cleanupError },
        'SERVER STARTUP CLEANUP FAILED',
      );
    }

    process.exit(1);
  }
}

void startServer();
