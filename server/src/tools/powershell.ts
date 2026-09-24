import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MachineAdapter } from '../core/adapter.js';
import { jsonResult } from './result.js';
import { getConfig } from '../config/index.js';
import { truncateUtf8 } from '../util/output.js';

/**
 * powershell — run a (multiline) PowerShell 7 script. There are no artificial
 * restrictions on commands: scripts run with the rights of the account that
 * runs Claw PC.
 */
export function registerPowerShell(server: McpServer, adapter: MachineAdapter): void {
  server.registerTool(
    'powershell',
    {
      title: 'Run PowerShell',
      annotations: { title: 'Run PowerShell', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Run a PowerShell 7 script (multiline supported) on the machine and return stdout, stderr, and exit code. Use for anything expressed more naturally in PowerShell than a single executable. For long-running work use job_start.',
      inputSchema: {
        script: z.string().describe('PowerShell script text. Multiline is supported.'),
        cwd: z.string().optional().describe('Working directory.'),
        env: z.record(z.string(), z.string()).optional().describe('Extra environment variables.'),
        timeoutSeconds: z.number().optional().describe('Timeout in seconds, clamped to the server maximum.'),
        elevated: z.boolean().optional().describe('Not supported: Claw PC never runs elevated, so this is ignored.'),
      },
    },
    async (input) => {
      const cfg = getConfig();
      const result = await adapter.runPowerShell({
        script: input.script,
        cwd: input.cwd,
        env: input.env,
        timeoutSeconds: input.timeoutSeconds,
        elevated: input.elevated,
      });
      const out = truncateUtf8(result.stdout, cfg.MAX_OUTPUT_BYTES);
      const err = truncateUtf8(result.stderr, Math.floor(cfg.MAX_OUTPUT_BYTES / 4));
      return jsonResult({
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        truncated: out.truncated || err.truncated,
        stdout: out.text,
        stderr: err.text,
      });
    },
  );
}
