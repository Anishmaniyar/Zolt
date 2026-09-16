import app from './app.js';
import { config } from '../config/env.config.js';

const PORT = config.server.port;

async function startServer() {
  try {
    app.listen(PORT, async () => {
      console.log(`Server is running smoothly on port ${PORT} in development mode`);
    });
  } catch (error) {
    console.error('CRITICAL ERROR: Failed to start the backed system: ', error);
    process.exit(1);
  }
}

startServer();
