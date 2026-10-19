import express, { type Express } from 'express';

import { bootstrap } from '../bootstrap/index.js';

// Builds a configured Express application without starting an HTTP listener.
// Tests can call this to get an isolated app instance.
export function createApp(): Express {
  const app = express();

  bootstrap(app);

  return app;
}

export default createApp();
