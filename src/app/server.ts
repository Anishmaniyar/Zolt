import app from './app.js';
import { config } from '../config/env.config.js';
import { closeQueue, configureQueue } from '../infrastructure/queue/queue.js';
import { closeRedis } from '../infrastructure/redis/redis.js';
import { closeDatabase } from '../infrastructure/database/pool.js';
import { logger } from '../shared/logger/logger.js';

const PORT = config.server.port;

// Configures the queue, starts the HTTP server, and wires graceful shutdown signals.
async function startServer() {
  try {
    await configureQueue();

    const server = app.listen(PORT, async () => {
      logger.info({ event: 'server.started', port: PORT, env: config.env }, 'SERVER STARTED');
    });

    // Closes the HTTP server plus Redis, Postgres, and queue connections, then exits.
    const shutdown = async (signal: string) => {
      logger.info({ event: 'server.stopping', signal }, 'SERVER STOPPING');

      server.close(async () => {
        await closeRedis();
        await closeDatabase();
        await closeQueue();

        logger.info({ event: 'server.stopped', signal }, 'SERVER STOPPED');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ event: 'server.start_failed', error }, 'SERVER START FAILED');
    process.exit(1);
  }
}

startServer();
