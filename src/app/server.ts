import app from './app.js';
import { config } from '../config/env.config.js';
import { closeQueue, configureQueue } from '../infrastructure/queue/queue.js';
import { closeRedis } from '../infrastructure/redis/redis.js';
import { closeDatabase } from '../infrastructure/database/pool.js';

const PORT = config.server.port;

async function startServer() {
  try {
    await configureQueue();

    const server = app.listen(PORT, async () => {
      console.log(`Server is running smoothly on port ${PORT} in development mode`);
    });

    const shutdown = async (signal: string) => {
      console.log(`${signal} received. Shutting down ...`);

      server.close(async () => {
        await closeRedis();
        await closeDatabase();
        await closeQueue();

        console.log('Shutdown complete');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('CRITICAL ERROR: Failed to start the backed system: ', error);
    process.exit(1);
  }
}

startServer();
