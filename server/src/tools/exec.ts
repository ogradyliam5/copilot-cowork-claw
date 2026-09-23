import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MachineAdapter } from '../core/adapter.js';
import { jsonResult } from './result.js';
import { getConfig } from '../config/index.js';
import { truncateUtf8 } from '../util/output.js';

/**
 * exec — run an arbitrary process (command + args, NOT a shell string).
 *
 * command+args is safer and more reliable than a single shell string: no quoting
 * ambiguity, no accidental shell metacharacter interpretation. The agent installs
 * tools and drives CLIs through this and `powershell`.
 *
 * Input schema is intentionally flat (no $ref, single types per property).
 */
export function registerExec(server: McpServer, adapter: MachineAdapter): void {
  server.registerTool(
    'exec',
    {
      title: 'Run a command',
      annotations: { title: 'Run a command', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Run an executable on the machine by command and argument list (not a shell string). Returns stdout, stderr, exit code, and duration. Use this to run CLIs, git, builds, tests, and to install tools (e.g. winget, npm, pip). For work that may take longer than ~20 seconds, use job_start instead.',
      inputSchema: {
        command: z.string().describe('Executable name or full path, e.g. "git" or "C:\\\\tools\\\\foo.exe".'),
        args: z.array(z.string()).optional().describe('Argument list. Each argument is passed verbatim.'),
        cwd: z.string().optional().describe('Working directory. Defaults to the service working directory.'),
        env: z.record(z.string(), z.string()).optional().describe('Extra environment variables merged over the process environment.'),
        timeoutSeconds: z.number().optional().describe('Timeout in seconds. Clamped to the server maximum.'),
      },
    },
    async (input) => {
      const cfg = getConfig();
      const result = await adapter.runProcess({
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        env: input.env,
        timeoutSeconds: input.timeoutSeconds,
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
