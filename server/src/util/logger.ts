import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/index.js';

/**
 * Structured JSON logger. Writes to stdout (claw.ps1 saves it to
 * server.out.log) and, when a log directory is configured, to a rotating file.
 */
function createLogger(): pino.Logger {
  const cfg = getConfig();
  try {
    fs.mkdirSync(cfg.LOG_DIRECTORY, { recursive: true });
  } catch {
    // fall back to stdout-only if the directory can't be created
  }

  const streams: pino.StreamEntry[] = [{ level: cfg.LOG_LEVEL, stream: process.stdout }];
  try {
    const file = path.join(cfg.LOG_DIRECTORY, 'claw-server.log');
    streams.push({ level: cfg.LOG_LEVEL, stream: pino.destination({ dest: file, mkdir: true, sync: false }) });
  } catch {
    // stdout only
  }

  return pino(
    {
      level: cfg.LOG_LEVEL,
      base: { service: 'claw-server' },
      redact: {
        paths: ['req.headers["x-api-key"]', 'req.headers.authorization', 'apiKey', 'password'],
        censor: '***REDACTED***',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );
}

export const logger = createLogger();
