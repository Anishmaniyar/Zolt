import app from './app.js';
import { config } from '../config/env.config.js';
import { configureQueue } from '../infrastructure/queue/queue.js';

const PORT = config.server.port;

async function startServer() {
  try {
    await configureQueue();

    app.listen(PORT, async () => {
      console.log(`Server is running smoothly on port ${PORT} in development mode`);
    });
  } catch (error) {
    console.error('CRITICAL ERROR: Failed to start the backed system: ', error);
    process.exit(1);
  }
}

startServer();
