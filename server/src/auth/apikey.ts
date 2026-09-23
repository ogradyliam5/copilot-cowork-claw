import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/index.js';

/**
 * API-key middleware. v0.1 auth: a shared secret in a configurable header,
 * compared in constant time. When no API_KEY is configured, auth is disabled
 * (development only) and a warning is logged at startup elsewhere.
 *
 * The seam is deliberately thin so Entra ID / OAuth can replace it later.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const cfg = getConfig();
  if (!cfg.authEnabled) {
    next();
    return;
  }

  const headerName = cfg.API_KEY_HEADER.toLowerCase();
  const provided = req.headers[headerName];
  const providedStr = Array.isArray(provided) ? provided[0] : provided;

  if (!providedStr || !safeEqual(providedStr, cfg.API_KEY)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
    return;
  }
  next();
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against self to keep timing uniform, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}
