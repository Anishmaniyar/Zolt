import pino from 'pino';
import { config } from '../../config/env.config.js';

const isDevelopment = config.env === 'development';

export const logger = pino({
  name: 'zolt',
  level: config.level,

  base: {
    service: 'zolt',
    environment: config.env ?? 'development',
  },

  redact: {
    paths: [
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'secret',
      'apiKey',
      'authorization',
      'cookie',
      'headers.authorization',
      'headers.cookie',
      'payload.password',
      'payload.token',
      'payload.secret',
      'payload.email',
      'payload.phone',
    ],
    censor: '[REDACTED]',
  },

  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
});
