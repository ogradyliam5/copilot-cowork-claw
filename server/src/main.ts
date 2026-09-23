import 'dotenv/config';
import { getConfig } from './config/index.js';
import { createApp } from './server/app.js';
import { WindowsAdapter } from './core/windows-adapter.js';
import { logger } from './util/logger.js';
import { version } from './server/version.js';

/**
 * Entry point: load config, build the app with the Windows adapter, listen.
 */
function main(): void {
  const cfg = getConfig();
  // Keep claw's own settings out of the commands the agent runs: they can't read the API key,
  // and apps they start don't pick up claw's HOST or PORT.
  for (const key of ['API_KEY', 'API_KEY_HEADER', 'HOST', 'PORT']) delete process.env[key];
  const adapter = new WindowsAdapter();
  const app = createApp(adapter);

  if (!cfg.authEnabled) {
    logger.warn('API_KEY is not set — authentication is DISABLED. Do not expose this server publicly.');
  }

  const server = app.listen(cfg.PORT, cfg.HOST, () => {
    logger.info({ host: cfg.HOST, port: cfg.PORT, version }, 'claw-server listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
