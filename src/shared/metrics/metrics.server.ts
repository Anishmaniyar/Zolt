import { createServer } from 'node:http';
import { register } from './registry.js';
import { logger } from '../logger/logger.js';

export function startMetricsServer(port: number) {
  const server = createServer(async (req, res) => {
    if (req.url === '/metrics') {
      try {
        const metrics = await register.metrics();

        res.writeHead(200, {
          'Content-Type': register.contentType,
        });

        res.end(metrics);
      } catch (error) {
        console.error('Metrics error:', error);
        res.statusCode = 500;
        res.end('Internal Server Error');
      }

      return;
    }

    res.statusCode = 404;
    res.end('Not Found');
  });

  // A port collision (for example a second worker started with the same
  // metrics port) must be reported, not thrown as an unhandled 'error' event
  // that kills the whole process.
  server.on('error', (error) => {
    logger.error(
      { event: 'metrics.server.error', port, error },
      'METRICS SERVER FAILED TO START',
    );
  });

  server.listen(port, () => {
    logger.info({ event: 'metrics.server.started', port }, 'METRICS SERVER STARTED');
  });

  return server;
}
