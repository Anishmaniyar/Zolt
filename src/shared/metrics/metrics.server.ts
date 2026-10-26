import { createServer } from 'node:http';
import { register } from './registry.js';

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

  server.listen(port, () => {
    console.log(`Metrics server running on port ${port}`);
  });

  return server;
}
