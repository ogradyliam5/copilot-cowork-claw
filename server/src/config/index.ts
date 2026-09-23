import { z } from 'zod';
import os from 'node:os';
import path from 'node:path';

/**
 * Environment-driven configuration for claw-server.
 *
 * All configuration is explicit and portable. Nothing machine-specific is
 * hard-coded; every value has a sensible default or is read from the
 * environment. Secrets (API_KEY) come only from the environment.
 */

const DEFAULT_PROGRAM_DATA = process.env.ProgramData ?? path.join(os.homedir(), '.claw');

const RawConfig = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().max(65535).default(8787),

  /** Shared secret required in the API key header. Empty disables auth (dev only). */
  API_KEY: z.string().default(''),
  /** Header name Copilot Studio sends the key in. */
  API_KEY_HEADER: z.string().default('x-api-key'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_DIRECTORY: z.string().default(path.join(DEFAULT_PROGRAM_DATA, 'claw', 'logs')),
  JOB_DIRECTORY: z.string().default(path.join(DEFAULT_PROGRAM_DATA, 'claw', 'jobs')),

  /** Hard cap on bytes returned in any single tool response (stays under Copilot Studio's ~500KB). */
  MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(200_000),
  DEFAULT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(600),

  /** Path to PowerShell 7. Falls back to Windows PowerShell / pwsh on PATH. */
  POWERSHELL_PATH: z.string().default('pwsh'),
});

export type Config = z.infer<typeof RawConfig> & {
  /** Whether API key auth is enforced. */
  authEnabled: boolean;
};

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = RawConfig.parse(env);
  return { ...parsed, authEnabled: parsed.API_KEY.length > 0 };
}

export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Reset cache — test helper. */
export function _resetConfig(): void {
  cached = undefined;
}
