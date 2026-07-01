import pino from 'pino';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const LOG_DIR = join(homedir(), '.infinite-ai', 'logs');
try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, destination: 1 },
  },
});

